const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),Module=require("node:module");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const {ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
const {expand}=require("../public/electron/sync-v2/entities");
const {occurrenceID}=require("../public/electron/e2ee/recurrence");

// The undo notice's restores (#107). The renderer keeps a snapshot of what it deletes; the
// composites bring it back as new rows in one change. Synthetic local vault; no network, no
// user data.
function adapter(t,now){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-undo-"));
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,2),scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const replica=new EncryptedReplica(store,{vaultId:"vault",epoch:"1",deviceId:"owner"});
 return {app:new ApplicationAdapter(replica,now?{now}:{}),replica};
}
const task=(app,tid)=>app.lists().tasks.find(row=>row.tid===tid);
const subtaskRows=(app,tid)=>app.lists().subtasks.filter(row=>row.tid===tid);
const DAY=86400000,due=Date.parse("2026-10-21T14:59:00Z");
// What TodoContent sends: the task's fields, category ids, subtasks in the shown order and
// its neighbours in the stored order.
function snapshot(app,tid,extra){
 const lists=app.lists(),row=task(app,tid),i=lists.tasks.findIndex(other=>other.tid===tid);
 return {tid:"restored",title:row.title,memo:row.memo,created_at:row.created_at,done:row.done,done_at:row.done_at,due_date:row.due_date,
  repeat_period:row.repeat_period,repeat_start_at:row.repeat_start_at,important:row.important===true,
  categories:lists.relations.filter(r=>r.tid===tid).map(r=>r.cid),
  subtasks:subtaskRows(app,tid).map(s=>({title:s.title,done:s.done,done_at:s.done_at,created_at:s.created_at,due_date:s.due_date})),
  prevId:lists.tasks[i-1]?.tid??null,nextId:lists.tasks[i+1]?.tid??null,...extra};
}

test("task/restoreTask brings a deleted task back as one change: fields, live categories, subtasks and its place",t=>{
 const clock=Date.parse("2026-11-05T00:00:00Z");
 const {app,replica}=adapter(t,()=>clock);
 app.mutate("category/createCategory",[{cid:"work",title:"Work"}]);
 app.mutate("category/createCategory",[{cid:"gone",title:"Gone"}]);
 for(const tid of ["a","b","c"])app.mutate("task/addTask",[{tid,title:tid.toUpperCase()}]);
 app.mutate("task/addTask",[{tid:"src",title:"Report",memo:"memo text",created_at:1000,due_date:due,repeat_period:"week",important:true,categories:["work","gone"]}]);
 app.mutate("task/updateTaskOrder",["src","a",true]);
 app.mutate("task/addTask",[{tid:"keep",title:"Keep",categories:["gone"]}]);
 app.mutate("task/createSubtask",[{sid:"s1",title:"First",created_at:10},"src"]);
 app.mutate("task/createSubtask",[{sid:"s2",title:"Second",created_at:20,due_date:due-DAY},"src"]);
 app.mutate("task/createSubtask",[{sid:"s3",title:"Third",created_at:30},"src"]);
 app.mutate("task/updateSubtaskDone",["src","s2",true,5000]);
 assert.deepEqual(app.lists().tasks.map(row=>row.tid),["a","src","b","c","keep"]);
 const snap=snapshot(app,"src");
 app.mutate("task/deleteTask",["src"]);
 app.mutate("category/deleteCategoryInUse",["gone"]);
 // The steps: create, move next to the old neighbour, the subtasks (no moves: created_at order).
 const steps=expand("task/restoreTask",[snap],app.view(),clock);
 assert.deepEqual(steps.map(([topic])=>topic),["task/addTask","task/updateTaskOrder","task/createSubtask","task/createSubtask","task/createSubtask"]);
 assert.deepEqual(steps[1][1],["restored","a",true]);
 assert.deepEqual(steps[0][1][0].categories,["work"]);
 const before=replica.status().pending;
 assert.ok(app.mutate("task/restoreTask",[snap]));
 assert.equal(replica.status().pending,before+1);
 const lists=app.lists(),row=task(app,"restored");
 assert.deepEqual(lists.tasks.map(r=>r.tid),["a","restored","b","c","keep"]);
 assert.equal(row.title,"Report");assert.equal(row.memo,"memo text");assert.equal(row.created_at,1000);
 assert.equal(row.due_date,due);assert.equal(row.repeat_period,"week");assert.equal(row.repeat_start_at,due);
 assert.equal(row.important,true);assert.equal(row.done,false);
 assert.deepEqual(lists.relations.filter(r=>r.tid==="restored"),[{tid:"restored",cid:"work"}]);
 const subs=subtaskRows(app,"restored");
 assert.deepEqual(subs.map(s=>[s.title,s.done,s.done_at,s.created_at,s.due_date]),[["First",false,0,10,0],["Second",true,5000,20,due-DAY],["Third",false,0,30,0]]);
 assert.ok(subs.every(s=>!["s1","s2","s3"].includes(s.sid)));
 // The deleted rows stay deleted, and the same new id cannot be created twice.
 assert.equal(task(app,"src"),undefined);
 assert.throws(()=>app.mutate("task/restoreTask",[snap]),/ENTITY_EXISTS|ENTITY_RECREATE/);
});

test("task/restoreTask keeps a dragged subtask order and a done task's time, and falls back to the next neighbour",t=>{
 const {app}=adapter(t);
 for(const tid of ["a","b"])app.mutate("task/addTask",[{tid,title:tid}]);
 app.mutate("task/addTask",[{tid:"src",title:"Src",created_at:500}]);
 app.mutate("task/updateTaskOrder",["src","b",false]);
 for(const [sid,created_at] of [["x",100],["y",200],["z",300]])app.mutate("task/createSubtask",[{sid,title:sid,created_at},"src"]);
 app.mutate("task/updateSubtaskOrder",["src","z","x",false]);
 app.mutate("task/updateTaskDone",["src",true,7000]);
 assert.deepEqual(subtaskRows(app,"src").map(s=>s.title),["z","x","y"]);
 const snap=snapshot(app,"src");
 assert.equal(snap.prevId,"a");
 app.mutate("task/deleteTask",["src"]);
 app.mutate("task/deleteTask",["a"]);
 const steps=expand("task/restoreTask",[snap],app.view());
 assert.equal(steps.filter(([topic])=>topic==="task/updateSubtaskOrder").length,2);
 assert.deepEqual(steps[1][1],["restored","b",false]);
 app.mutate("task/restoreTask",[snap]);
 assert.deepEqual(app.lists().tasks.map(r=>r.tid),["restored","b"]);
 assert.deepEqual(subtaskRows(app,"restored").map(s=>s.title),["z","x","y"]);
 assert.equal(task(app,"restored").done,true);assert.equal(task(app,"restored").done_at,7000);
 // No neighbour left: it goes where a new task goes, without a move.
 const lone=snapshot(app,"restored",{tid:"lone"});
 app.mutate("task/deleteTask",["restored"]);app.mutate("task/deleteTask",["b"]);
 assert.equal(expand("task/restoreTask",[lone],app.view()).some(([topic])=>topic==="task/updateTaskOrder"),false);
 app.mutate("task/restoreTask",[lone]);
 assert.deepEqual(app.lists().tasks.map(r=>r.tid),["lone"]);
});

test("task/restoreTask and task/restoreSubtask reject a bad snapshot and queue nothing",t=>{
 const {app,replica}=adapter(t);
 app.mutate("task/addTask",[{tid:"t",title:"T"}]);
 const before=replica.status().pending;
 for(const bad of [null,"x",{title:5},{title:"x",categories:"work"},{title:"x",subtasks:{}},{title:"x",subtasks:[{title:null}]},
  {title:"x",subtasks:[null]},{title:"x",due_date:-1},{title:"x",created_at:1.5},{title:"x",memo:7},{title:"x",categories:[3]}])
  assert.throws(()=>app.mutate("task/restoreTask",[bad]),/INVALID_RESTORE/,JSON.stringify(bad));
 assert.throws(()=>app.mutate("task/restoreSubtask",["t",{title:9}]),/INVALID_RESTORE/);
 assert.throws(()=>app.mutate("task/restoreSubtask",["t",null]),/INVALID_RESTORE/);
 assert.throws(()=>app.mutate("task/restoreSubtask",["t",{title:"x",done_at:"soon"}]),/INVALID_RESTORE/);
 assert.throws(()=>app.mutate("task/restoreSubtask",["missing",{title:"x"}]),/ENTITY_DELETED/);
 assert.equal(replica.status().pending,before);
 // The recurring due step is internal: the renderer cannot send it.
 assert.throws(()=>app.mutate("task/restoreRecurringDue",["t",due]),/UNSUPPORTED_APPLICATION_ACTION/);
});

test("task/restoreSubtask puts a deleted subtask back with its done state, in its old place",t=>{
 const {app,replica}=adapter(t);
 app.mutate("task/addTask",[{tid:"t",title:"T"}]);
 for(const [sid,created_at] of [["a",100],["b",200],["c",300]])app.mutate("task/createSubtask",[{sid,title:sid,created_at},"t"]);
 app.mutate("task/updateSubtaskDone",["t","b",true,4000]);
 const shown=()=>subtaskRows(app,"t").map(s=>s.title);
 // Unranked: the old created_at is enough, no move.
 app.mutate("task/deleteSubtask",["t","b"]);
 const b={title:"b",done:true,done_at:4000,created_at:200,due_date:null};
 assert.deepEqual(expand("task/restoreSubtask",["t",b,{prevId:"a",nextId:"c"}],app.view()).map(([topic])=>topic),["task/createSubtask"]);
 const before=replica.status().pending;
 app.mutate("task/restoreSubtask",["t",b,{prevId:"a",nextId:"c"}]);
 assert.equal(replica.status().pending,before+1);
 assert.deepEqual(subtaskRows(app,"t").map(s=>[s.title,s.done,s.done_at,s.created_at]),[["a",false,0,100],["b",true,4000,200],["c",false,0,300]]);
 // Ranked (dragged): it moves next to its old neighbour, or before the next one when that is gone.
 app.mutate("task/updateSubtaskOrder",["t","a","c",true]);
 assert.deepEqual(shown(),["b","c","a"]);
 const bId=subtaskRows(app,"t").find(s=>s.title==="b").sid,cId=subtaskRows(app,"t").find(s=>s.title==="c").sid;
 app.mutate("task/deleteSubtask",["t",cId]);
 const near={prevId:bId,nextId:"a"};
 const steps=expand("task/restoreSubtask",["t",{title:"c",created_at:300},near],app.view());
 assert.deepEqual(steps.map(([topic])=>topic),["task/createSubtask","task/updateSubtaskOrder"]);
 assert.deepEqual(steps[1][1].slice(2),[bId,true]);
 app.mutate("task/restoreSubtask",["t",{title:"c",created_at:300},near]);
 assert.deepEqual(shown(),["b","c","a"]);
 app.mutate("task/deleteSubtask",["t",subtaskRows(app,"t").find(s=>s.title==="c").sid]);
 app.mutate("task/deleteSubtask",["t",bId]);
 app.mutate("task/restoreSubtask",["t",{title:"c",created_at:300},near]);
 assert.deepEqual(shown(),["c","a"]);
});

test("task/undoRecurringCompletion deletes the done copy and puts the due date and subtasks back",t=>{
 const clock=Date.parse("2026-10-21T00:00:00Z");
 const {app,replica}=adapter(t,()=>clock);
 app.mutate("category/createCategory",[{cid:"work",title:"Work"}]);
 app.mutate("task/addTask",[{tid:"w",title:"Weekly",due_date:due,repeat_period:"week",categories:["work"]}]);
 app.mutate("task/createSubtask",[{sid:"s1",title:"One",created_at:10,due_date:due-3600000},"w"]);
 app.mutate("task/createSubtask",[{sid:"s2",title:"Two",created_at:20},"w"]);
 app.mutate("task/updateSubtaskDone",["w","s2",true,1234]);
 const generation=task(app,"w").recurrence_generation;
 app.mutate("task/updateTaskDone",["w",true]);
 const copyId=occurrenceID("fixture","w",generation,"task");
 assert.ok(task(app,copyId));
 assert.equal(task(app,"w").due_date,due+7*DAY);
 assert.deepEqual(subtaskRows(app,"w").map(s=>s.done),[false,false]);
 // A stale undo (another due) is refused before anything changes.
 assert.throws(()=>app.mutate("task/undoRecurringCompletion",["w",{due_date:due+DAY}]),/STALE_OCCURRENCE/);
 const steps=expand("task/undoRecurringCompletion",["w",{due_date:due}],app.view(),clock,{accountId:"fixture"});
 assert.deepEqual(steps.slice(0,2).map(([topic])=>topic),["task/deleteTask","task/restoreRecurringDue"]);
 assert.deepEqual(steps.slice(2).map(([topic,args])=>[topic,args[1]]).sort(),[["task/updateSubtaskDone","s2"],["task/updateSubtaskDueDate","s1"]]);
 const pending=replica.status().pending;
 assert.ok(app.mutate("task/undoRecurringCompletion",["w",{due_date:due}]));
 assert.equal(replica.status().pending,pending+1);
 const lists=app.lists(),row=task(app,"w");
 assert.equal(task(app,copyId),undefined);
 assert.equal(lists.subtasks.some(s=>s.tid===copyId),false);
 assert.equal(row.due_date,due);assert.equal(row.repeat_start_at,due);assert.equal(row.repeat_period,"week");assert.equal(row.done,false);
 assert.deepEqual(subtaskRows(app,"w").map(s=>[s.sid,s.done,s.done_at,s.due_date]),[["s1",false,0,due-3600000],["s2",true,1234,0]]);
 assert.deepEqual(lists.relations,[{tid:"w",cid:"work"}]);
 // Undo works once; completing again makes a new copy (a new generation, no recreated id).
 assert.throws(()=>app.mutate("task/undoRecurringCompletion",["w",{due_date:due}]),/STALE_OCCURRENCE/);
 assert.notEqual(task(app,"w").recurrence_generation,generation);
 assert.doesNotThrow(()=>app.mutate("task/updateTaskDone",["w",true]));
 assert.equal(task(app,"w").due_date,due+7*DAY);
 assert.equal(app.lists().tasks.filter(r=>r.title==="Weekly"&&r.done).length,1);
 // Not a repeating task, or no account (plaintext): refused.
 app.mutate("task/addTask",[{tid:"once",title:"Once",due_date:due}]);
 assert.throws(()=>app.mutate("task/undoRecurringCompletion",["once",{due_date:due}]),/NOT_RECURRING/);
 assert.throws(()=>expand("task/undoRecurringCompletion",["w",{due_date:due+7*DAY}],app.view()),/UNSUPPORTED_V2_ACTION/);
});

test("task/undoRecurringCompletion keeps a moved repeat anchor (a monthly task on the 31st)",t=>{
 const start=Date.parse("2026-08-31T14:59:00Z");
 let clock=Date.parse("2026-09-01T00:00:00Z");
 const {app}=adapter(t,()=>clock);
 app.mutate("task/addTask",[{tid:"m",title:"Monthly",due_date:start,repeat_period:"month"}]);
 app.mutate("task/updateTaskDone",["m",true]);
 const rolled=task(app,"m").due_date;
 assert.notEqual(rolled,start);
 clock=rolled;
 app.mutate("task/updateTaskDone",["m",true]);
 const next=task(app,"m");
 app.mutate("task/undoRecurringCompletion",["m",{due_date:rolled}]);
 // The due goes back; the anchor stays on the 31st (task/updateTaskDueDate would move it).
 assert.equal(task(app,"m").due_date,rolled);
 assert.equal(task(app,"m").repeat_start_at,start);
 assert.equal(next.repeat_start_at,start);
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

test("plaintext v2 queues a restore as its steps without subtask moves, and refuses the recurring undo",async()=>{
 const rows=[row("task","a",{title:"A"}),row("category","work",{title:"Work"})];
 const {service,events,queued}=plaintextService(rows);
 const snap={tid:"back",title:"Back",categories:["work","gone"],important:true,prevId:"a",
  subtasks:[{title:"Late",created_at:20},{title:"Early",created_at:10}]};
 assert.equal(await service.intercept("task/restoreTask","restore",[snap]),true);
 assert.deepEqual(queued.map(change=>[change.entityType,change.operation]),[["task","create"],["task","move"],["subtask","create"],["subtask","create"]]);
 assert.deepEqual(queued[0].categoryIds,["work"]);
 assert.equal(Object.hasOwn(queued[0].changes,"important"),false);
 assert.equal(events.find(e=>e[0]==="task/restoreTask")[2],true);
 await service.intercept("task/undoRecurringCompletion","undo",["a",{due_date:due}]);
 assert.deepEqual(events.find(e=>e[0]==="task/undoRecurringCompletion").slice(2),[false,{syncV2Ack:true,code:"UNSUPPORTED_V2_ACTION"}]);
});

test("the restore topics are open to the window and answered as unsupported on the legacy path",()=>{
 const {REQUEST_TOPICS}=require("../public/electron/modules/preload");
 const legacy=fs.readFileSync(path.join(__dirname,"../public/electron/configures/ipc.config.js"),"utf8");
 for(const topic of ["task/restoreTask","task/restoreSubtask","task/undoRecurringCompletion"]){
  assert.ok(REQUEST_TOPICS.includes(topic),topic);
  assert.ok(legacy.includes(`"${topic}",`),topic);
 }
 assert.equal(REQUEST_TOPICS.includes("task/restoreRecurringDue"),false);
});
