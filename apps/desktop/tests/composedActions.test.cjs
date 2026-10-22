const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),Module=require("node:module");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const {ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");

// Synthetic local vault; no network, no user data.
function adapter(t,now){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-composed-"));
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,2),scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const replica=new EncryptedReplica(store,{vaultId:"vault",epoch:"1",deviceId:"owner"});
 return {app:new ApplicationAdapter(replica,now?{now}:{}),replica};
}
const task=(app,tid)=>app.lists().tasks.find(row=>row.tid===tid);
const DAY=86400000,due=Date.parse("2026-10-21T14:59:00Z");

test("moving the due date of a repeating task moves the repeat anchor with it",t=>{
 const {app}=adapter(t);
 app.mutate("task/addTask",[{tid:"weekly",title:"Weekly",due_date:due,repeat_period:"week"}]);
 assert.equal(task(app,"weekly").repeat_start_at,due);
 const generation=task(app,"weekly").recurrence_generation;
 app.mutate("task/updateTaskDueDate",["weekly",due+2*DAY]);
 assert.equal(task(app,"weekly").due_date,due+2*DAY);
 assert.equal(task(app,"weekly").repeat_start_at,due+2*DAY);
 assert.equal(task(app,"weekly").repeat_period,"week");
 assert.notEqual(task(app,"weekly").recurrence_generation,generation);
 // A task without a repeat only changes its due date.
 app.mutate("task/addTask",[{tid:"once",title:"Once",due_date:due}]);
 app.mutate("task/updateTaskDueDate",["once",due+DAY]);
 assert.equal(task(app,"once").due_date,due+DAY);
 assert.equal(task(app,"once").repeat_start_at,0);
});

test("turning a repeat off and on again anchors it on the current due date",t=>{
 const {app}=adapter(t);
 app.mutate("task/addTask",[{tid:"r",title:"R",due_date:due,repeat_period:"week"}]);
 app.mutate("task/updateTaskRepeatPeriod",["r",""]);
 assert.equal(task(app,"r").repeat_start_at,0);
 app.mutate("task/updateTaskDueDate",["r",due+3*DAY]);
 app.mutate("task/updateTaskRepeatPeriod",["r","week"]);
 assert.equal(task(app,"r").repeat_start_at,due+3*DAY);
 // Picking the same period again changes nothing.
 const generation=task(app,"r").recurrence_generation;
 app.mutate("task/updateTaskRepeatPeriod",["r","week"]);
 assert.equal(task(app,"r").recurrence_generation,generation);
 assert.equal(task(app,"r").repeat_start_at,due+3*DAY);
 // Without a due date a repeat is still refused, as before (set the due date first).
 app.mutate("task/addTask",[{tid:"none",title:"None"}]);
 assert.throws(()=>app.mutate("task/updateTaskRepeatPeriod",["none","day"]),/RECURRENCE_RANGE/);
});

test("after completions, a new period anchors on the current due date and re-saving the due changes nothing",t=>{
 let clock=Date.parse("2026-10-01T00:00:00Z");
 const {app}=adapter(t,()=>clock);
 const start=Date.parse("2026-10-01T14:59:00Z");
 app.mutate("task/addTask",[{tid:"w",title:"W",due_date:start,repeat_period:"week"}]);
 // Three completions roll the due date to 10/22 while the anchor stays on 10/1.
 for(let i=0;i<3;i++){clock=task(app,"w").due_date;app.mutate("task/updateTaskDone",["w",true]);}
 const rolled=task(app,"w");
 assert.equal(rolled.due_date,Date.parse("2026-10-22T14:59:00Z"));
 assert.equal(rolled.repeat_start_at,start);
 // Saving the same due date again keeps the anchor and the generation (no new occurrence key).
 app.mutate("task/updateTaskDueDate",["w",rolled.due_date]);
 assert.equal(task(app,"w").repeat_start_at,start);
 assert.equal(task(app,"w").recurrence_generation,rolled.recurrence_generation);
 // Switching to monthly follows the day the picker names (the 22nd), so the next one is 11/22.
 app.mutate("task/updateTaskRepeatPeriod",["w","month"]);
 assert.equal(task(app,"w").repeat_start_at,rolled.due_date);
 const {nextDue}=require("@thread/e2ee/src/recurrence");
 const next=task(app,"w");
 assert.equal(nextDue(next.repeat_start_at,next.due_date,next.repeat_period,next.due_date),Date.parse("2026-11-22T14:59:00Z"));
});

test("clearing the due date of a repeating task clears the repeat instead of failing",t=>{
 const {app}=adapter(t);
 app.mutate("task/addTask",[{tid:"r",title:"R",due_date:due,repeat_period:"month"}]);
 assert.doesNotThrow(()=>app.mutate("task/updateTaskDueDate",["r",0]));
 const row=task(app,"r");
 assert.equal(row.due_date,0);assert.equal(row.repeat_period,"");assert.equal(row.repeat_start_at,0);
 // null works like 0, and clearing a task with no due date and no repeat still works.
 app.mutate("task/addTask",[{tid:"s",title:"S",due_date:due,repeat_period:"day"}]);
 assert.doesNotThrow(()=>app.mutate("task/updateTaskDueDate",["s",null]));
 assert.equal(task(app,"s").repeat_period,"");
 app.mutate("task/addTask",[{tid:"plain",title:"Plain"}]);
 assert.doesNotThrow(()=>app.mutate("task/updateTaskDueDate",["plain",0]));
});

test("category/deleteCategoryInUse removes the category from its tasks, keeps the tasks and queues one change",t=>{
 const {app,replica}=adapter(t);
 app.mutate("category/createCategory",[{cid:"work",title:"Work"}]);
 app.mutate("category/createCategory",[{cid:"home",title:"Home"}]);
 app.mutate("task/addTask",[{tid:"a",title:"A",categories:["work","home"]}]);
 app.mutate("task/addTask",[{tid:"b",title:"B",categories:["work"]}]);
 app.mutate("task/addTask",[{tid:"c",title:"C"}]);
 assert.throws(()=>app.mutate("category/deleteCategory",["work"]),/CATEGORY_IN_USE/);
 const before=replica.status().pending;
 assert.ok(app.mutate("category/deleteCategoryInUse",["work"]));
 assert.equal(replica.status().pending,before+1);
 const lists=app.lists();
 assert.deepEqual(lists.categories.map(row=>row.cid),["home"]);
 assert.deepEqual(lists.relations,[{tid:"a",cid:"home"}]);
 assert.deepEqual(lists.tasks.map(row=>row.tid),["a","b","c"]);
 // An unused category is simply deleted; a missing one is rejected.
 app.mutate("category/createCategory",[{cid:"spare",title:"Spare"}]);
 app.mutate("category/deleteCategoryInUse",["spare"]);
 assert.equal(app.lists().categories.some(row=>row.cid==="spare"),false);
 assert.throws(()=>app.mutate("category/deleteCategoryInUse",["work"]),/ENTITY_DELETED/);
});

test("deleting a category used by more than one draft can hold is queued in order, the delete last",t=>{
 const {app,replica}=adapter(t);
 app.mutate("category/createCategory",[{cid:"big",title:"Big"}]);
 for(let i=0;i<120;i++)app.mutate("task/addTask",[{tid:"t"+i,title:"T"+i,categories:["big"]}]);
 const before=replica.status().pending;
 app.mutate("category/deleteCategoryInUse",["big"]);
 assert.equal(replica.status().pending,before+2);
 assert.equal(app.lists().relations.length,0);
 assert.equal(app.lists().categories.length,0);
 assert.equal(app.lists().tasks.length,120);
 const drafts=replica.pending().slice(-2).map(row=>row.value.changes);
 assert.equal(drafts[0].some(change=>change.deleted),false);
 assert.equal(drafts[1].at(-1).deleted,true);
});

test("a conflict on the first draft of a split composite rebases the later drafts after it",t=>{
 const {app,replica}=adapter(t);
 app.mutate("category/createCategory",[{cid:"big",title:"Big"}]);
 for(let i=0;i<120;i++)app.mutate("task/addTask",[{tid:"t"+i,title:"T"+i,categories:["big"]}]);
 app.mutate("category/deleteCategoryInUse",["big"]);
 const [first,last]=replica.pending().slice(-2);
 // The later draft repeats one row of the first, so it waits for it and joins its rebase.
 assert.ok(last.value.changes.some(change=>first.value.changes.some(other=>other.objectId===change.objectId)));
 replica.rebase(first.id);
 const drafts=replica.pending().slice(-2).map(row=>row.value.changes);
 assert.equal(drafts[0].some(change=>change.deleted),false);
 assert.equal(drafts[0].length,100);
 assert.equal(drafts[1].at(-1).deleted,true);
 assert.equal(app.lists().relations.length,0);
 assert.equal(app.lists().categories.length,0);
});

test("category/deleteCategoryWithTasks deletes the tasks that have the category, their subtasks, then the category, in one change",t=>{
 const {app,replica}=adapter(t);
 app.mutate("category/createCategory",[{cid:"diary",title:"Diary",secret:true}]);
 app.mutate("category/createCategory",[{cid:"home",title:"Home"}]);
 app.mutate("task/addTask",[{tid:"a",title:"A",categories:["diary","home"]}]);
 app.mutate("task/addTask",[{tid:"b",title:"B",categories:["diary"],due_date:due,repeat_period:"day"}]);
 app.mutate("task/addTask",[{tid:"c",title:"C",categories:["home"]}]);
 app.mutate("task/createSubtask",[{sid:"s",title:"Sub",created_at:5},"b"]);
 const before=replica.status().pending;
 assert.ok(app.mutate("category/deleteCategoryWithTasks",["diary"]));
 assert.equal(replica.status().pending,before+1);
 const lists=app.lists();
 assert.deepEqual(lists.tasks.map(row=>row.tid),["c"]);
 assert.deepEqual(lists.categories.map(row=>row.cid),["home"]);
 assert.deepEqual(lists.subtasks,[]);
 assert.deepEqual(lists.relations,[{tid:"c",cid:"home"}]);
 // The deletions come last in the change set.
 const changes=replica.pending().at(-1).value.changes;
 assert.equal(changes.at(-1).deleted,true);
 // An unused category is simply deleted; a missing one is rejected.
 app.mutate("category/createCategory",[{cid:"spare",title:"Spare"}]);
 app.mutate("category/deleteCategoryWithTasks",["spare"]);
 assert.equal(app.lists().categories.some(row=>row.cid==="spare"),false);
 assert.throws(()=>app.mutate("category/deleteCategoryWithTasks",["diary"]),/ENTITY_DELETED/);
});

test("task/duplicateTask copies title, memo, due, repeat, importance, categories and subtasks into one new task",t=>{
 let clock=Date.parse("2026-10-22T00:00:00Z");
 const {app,replica}=adapter(t,()=>clock);
 app.mutate("category/createCategory",[{cid:"work",title:"Work"}]);
 app.mutate("category/createCategory",[{cid:"gone",title:"Gone"}]);
 app.mutate("task/addTask",[{tid:"src",title:"Report",memo:"memo text",due_date:due,repeat_period:"week",important:true,categories:["work","gone"]}]);
 app.mutate("task/deleteTaskCategory",["src","gone"]);app.mutate("category/deleteCategory",["gone"]);
 app.mutate("task/createSubtask",[{sid:"s2",title:"Second",created_at:20,due_date:due-DAY},"src"]);
 app.mutate("task/createSubtask",[{sid:"s1",title:"First",created_at:10},"src"]);
 app.mutate("task/createSubtask",[{sid:"s3",title:"Removed",created_at:30},"src"]);
 app.mutate("task/updateSubtaskDone",["src","s1",true]);
 app.mutate("task/deleteSubtask",["src","s3"]);
 app.mutate("task/updateTaskDueDate",["src",due+DAY]);
 clock+=1000;
 const before=replica.status().pending;
 assert.ok(app.mutate("task/duplicateTask",["src",{tid:"copy"}]));
 assert.equal(replica.status().pending,before+1);
 const lists=app.lists(),copy=task(app,"copy"),source=task(app,"src");
 assert.equal(copy.title,"Report");assert.equal(copy.memo,"memo text");
 assert.equal(copy.due_date,due+DAY);assert.equal(copy.repeat_period,"week");assert.equal(copy.repeat_start_at,due+DAY);
 assert.equal(copy.important,true);assert.equal(copy.done,false);assert.equal(copy.created_at,clock);
 assert.deepEqual(lists.relations.filter(row=>row.tid==="copy"),[{tid:"copy",cid:"work"}]);
 const subtasks=lists.subtasks.filter(row=>row.tid==="copy").sort((a,b)=>a.created_at-b.created_at);
 assert.deepEqual(subtasks.map(row=>[row.title,row.done,row.due_date]),[["First",false,0],["Second",false,due-DAY]]);
 assert.ok(subtasks.every(row=>!["s1","s2"].includes(row.sid)));
 // The source is unchanged.
 assert.equal(source.title,"Report");assert.equal(lists.subtasks.filter(row=>row.tid==="src").length,2);
 // A generated id when none is given; a deleted source is rejected.
 app.mutate("task/duplicateTask",["src"]);
 assert.equal(app.lists().tasks.filter(row=>row.title==="Report").length,3);
 app.mutate("task/deleteTask",["copy"]);
 assert.throws(()=>app.mutate("task/duplicateTask",["copy"]),/ENTITY_DELETED/);
 // A plain task copies without repeat, star or due.
 app.mutate("task/addTask",[{tid:"plain",title:"Plain"}]);
 app.mutate("task/duplicateTask",["plain",{tid:"plain2"}]);
 const plain=task(app,"plain2");
 assert.equal(plain.due_date,0);assert.equal(plain.repeat_period,"");assert.equal(plain.important,undefined);
});

function plaintextService(rows){
 const original=Module._load;
 Module._load=function(request,parent,...rest){
  if(parent?.filename.endsWith("sync-v2"+path.sep+"service.js")){
   if(request==="../modules/filesystem")return {getUserDataPath:()=>os.tmpdir()};
   if(request==="../modules/util")return {getServerFinalEndpoint:()=>"http://fixture/v1"};
  }
  return original.call(this,request,parent,...rest);
 };
 let SyncV2Service;
 try{({SyncV2Service}=require("../public/electron/sync-v2/service"));}finally{Module._load=original;}
 const events=[],queued=[],service=new SyncV2Service();
 service.inject({userService:{getCurrent:()=>"fixture"},ipcService:{sender:(...event)=>events.push(event)}});
 service.sessions.set("fixture",{uid:"fixture",connected:false,replica:{
  enqueue:async change=>{queued.push(change);return "change-"+queued.length;},
  enqueueMany:async builders=>{const batch=builders.map(build=>build({rows}));queued.push(...batch);return "change-"+queued.length;},
  view:async()=>({rows,pending:[],epoch:null}),meta:async()=>undefined}});
 return {service,events,queued};
}
const row=(entityType,entityId,fields,parentId)=>({entityType,entityId,parentId,operation:"upsert",version:"1",fields});

test("plaintext v2 queues the composites as their steps and drops the star from the copy",async()=>{
 const rows=[row("category","work",{title:"Work"}),row("task","src",{title:"Src",memo:"",due_date:due,repeat_period:"day",repeat_start_at:due,important:true}),
  row("taskCategory","work",{present:true},"src"),row("subtask","s",{title:"Sub",created_at:5},"src")];
 const {service,events,queued}=plaintextService(rows);
 assert.equal(await service.intercept("task/duplicateTask","dup",["src",{tid:"copy"}]),true);
 assert.deepEqual(queued.map(change=>[change.entityType,change.operation]),[["task","create"],["subtask","create"]]);
 assert.equal(queued[0].entityId,"copy");assert.deepEqual(queued[0].categoryIds,["work"]);
 assert.equal(Object.hasOwn(queued[0].changes,"important"),false);
 assert.equal(queued[1].parentId,"copy");
 assert.equal(events.find(e=>e[0]==="task/duplicateTask")[2],true);
 queued.length=0;
 assert.equal(await service.intercept("category/deleteCategoryInUse","del",["work"]),true);
 assert.deepEqual(queued.map(change=>[change.entityType,change.operation,change.parentId??null]),[["taskCategory","remove","src"],["category","delete",null]]);
 queued.length=0;
 assert.equal(await service.intercept("category/deleteCategoryWithTasks","delAll",["work"]),true);
 assert.deepEqual(queued.map(change=>[change.entityType,change.operation,change.entityId]),[["task","delete","src"],["category","delete","work"]]);
 assert.equal(events.find(e=>e[0]==="category/deleteCategoryWithTasks")[2],true);
 // The due/repeat patch is plain fields the server knows.
 queued.length=0;
 await service.intercept("task/updateTaskDueDate","due",["src",0]);
 assert.deepEqual(queued[0].changes,{due_date:0,repeat_period:"",repeat_start_at:0});
});
