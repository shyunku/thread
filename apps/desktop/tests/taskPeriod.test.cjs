const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const {ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
const {occurrenceID}=require("../public/electron/e2ee/recurrence");

// Task periods and per-task alerts (#109): start_offset (ms before the due) and alert_start /
// alert_end on the task row. Synthetic local vault; no network, no user data.
function adapter(t,now){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-period-"));
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,2),scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const replica=new EncryptedReplica(store,{vaultId:"vault",epoch:"1",deviceId:"owner"});
 return {app:new ApplicationAdapter(replica,now?{now}:{}),replica};
}
const task=(app,tid)=>app.lists().tasks.find(row=>row.tid===tid);
const DAY=86400000,H=3600000,due=Date.parse("2026-10-21T08:00:00Z"),start=due-3*DAY;

test("a new task keeps a valid period and alert choices; bad ones are refused, an offset without a due is dropped",t=>{
 const {app}=adapter(t);
 app.mutate("task/addTask",[{tid:"p",title:"P",due_date:due,start_offset:3*DAY,alert_start:"on",alert_end:"off"}]);
 assert.deepEqual([task(app,"p").start_offset,task(app,"p").alert_start,task(app,"p").alert_end],[3*DAY,"on","off"]);
 // What a new Task object sends without a period: offset 0, alerts null. Nothing is stored.
 app.mutate("task/addTask",[{tid:"plain",title:"Plain",due_date:due,start_offset:0,alert_start:null,alert_end:null}]);
 assert.equal(Object.hasOwn(task(app,"plain"),"start_offset"),false);
 assert.equal(Object.hasOwn(task(app,"plain"),"alert_start"),false);
 app.mutate("task/addTask",[{tid:"nodue",title:"No due",start_offset:DAY}]);
 assert.equal(Object.hasOwn(task(app,"nodue"),"start_offset"),false);
 for(const bad of [{start_offset:-1},{start_offset:due},{start_offset:1.5},{start_offset:"1"},{alert_start:"yes"},{alert_end:true}])
  assert.throws(()=>app.mutate("task/addTask",[{tid:"bad",title:"Bad",due_date:due,...bad}]),/INVALID_PERIOD|INVALID_ALERT/);
 assert.equal(task(app,"bad"),undefined);
});

test("moving the due keeps the offset (the start moves with it, as on older apps); no due clears it",t=>{
 const {app}=adapter(t);
 app.mutate("task/addTask",[{tid:"p",title:"P",due_date:due,start_offset:3*DAY}]);
 app.mutate("task/updateTaskDueDate",["p",due+DAY]);
 assert.equal(task(app,"p").due_date,due+DAY);
 assert.equal(task(app,"p").due_date-task(app,"p").start_offset,start+DAY);
 app.mutate("task/updateTaskDueDate",["p",0]);
 assert.deepEqual([task(app,"p").due_date,task(app,"p").start_offset],[0,0]);
 // A repeating task: no due clears the repeat and the start in the same patch.
 app.mutate("task/addTask",[{tid:"r",title:"R",due_date:due,start_offset:DAY,repeat_period:"week"}]);
 app.mutate("task/updateTaskDueDate",["r",null]);
 const r=task(app,"r");
 assert.deepEqual([r.due_date,r.start_offset,r.repeat_period,r.repeat_start_at],[0,0,"",0]);
 // A task without a start gets no start_offset field from a cleared due.
 app.mutate("task/addTask",[{tid:"d",title:"D",due_date:due}]);
 app.mutate("task/updateTaskDueDate",["d",0]);
 assert.equal(Object.hasOwn(task(app,"d"),"start_offset"),false);
});

test("task/updateTaskPeriod writes the due and the start in one patch, with the due's repeat anchor rules",t=>{
 const {app,replica}=adapter(t);
 app.mutate("task/addTask",[{tid:"p",title:"P",due_date:due}]);
 const pending=replica.status().pending;
 app.mutate("task/updateTaskPeriod",["p",{due:due+DAY,start:start}]);
 assert.equal(replica.status().pending,pending+1);
 assert.deepEqual([task(app,"p").due_date,task(app,"p").start_offset],[due+DAY,due+DAY-start]);
 // The start alone; equal to the due or 0 is no period.
 app.mutate("task/updateTaskPeriod",["p",{due:due+DAY,start:due}]);
 assert.equal(task(app,"p").start_offset,DAY);
 app.mutate("task/updateTaskPeriod",["p",{due:due+DAY,start:due+DAY}]);
 assert.equal(task(app,"p").start_offset,0);
 app.mutate("task/updateTaskPeriod",["p",{due:due+DAY,start:start}]);
 app.mutate("task/updateTaskPeriod",["p",{due:due+DAY,start:0}]);
 assert.equal(task(app,"p").start_offset,0);
 // Refused: a start after the due, a start without a due, bad numbers.
 for(const bad of [{due,start:due+1},{due:0,start},{due:-1},{due:"1"},{due,start:1.5}])
  assert.throws(()=>app.mutate("task/updateTaskPeriod",["p",bad]),/INVALID_PERIOD/);
 // No due clears both.
 app.mutate("task/updateTaskPeriod",["p",{due:due,start:start}]);
 app.mutate("task/updateTaskPeriod",["p",{due:0,start:0}]);
 assert.deepEqual([task(app,"p").due_date,task(app,"p").start_offset],[0,0]);
 // A repeating task: a new due moves the anchor; the same due with a new start leaves the anchor
 // and the recurrence generation alone (the start does not name the occurrence).
 app.mutate("task/addTask",[{tid:"r",title:"R",due_date:due,repeat_period:"week"}]);
 const generation=task(app,"r").recurrence_generation;
 app.mutate("task/updateTaskPeriod",["r",{due,start}]);
 assert.deepEqual([task(app,"r").repeat_start_at,task(app,"r").start_offset,task(app,"r").recurrence_generation],[due,3*DAY,generation]);
 app.mutate("task/updateTaskPeriod",["r",{due:due+2*DAY,start:start+2*DAY}]);
 assert.deepEqual([task(app,"r").repeat_start_at,task(app,"r").repeat_period,task(app,"r").start_offset],[due+2*DAY,"week",3*DAY]);
 assert.notEqual(task(app,"r").recurrence_generation,generation);
 app.mutate("task/updateTaskPeriod",["r",{due:0,start:0}]);
 assert.deepEqual([task(app,"r").repeat_period,task(app,"r").start_offset],["",0]);
});

test("task/updateTaskAlert sets one side on, off or back to the settings, and other edits keep it",t=>{
 const {app}=adapter(t);
 app.mutate("task/addTask",[{tid:"p",title:"P",due_date:due,start_offset:DAY}]);
 app.mutate("task/updateTaskAlert",["p","end","off"]);
 app.mutate("task/updateTaskAlert",["p","start","on"]);
 assert.deepEqual([task(app,"p").alert_start,task(app,"p").alert_end],["on","off"]);
 app.mutate("task/updateTaskTitle",["p","Renamed"]);
 app.mutate("task/updateTaskDueDate",["p",due+DAY]);
 assert.deepEqual([task(app,"p").alert_start,task(app,"p").alert_end],["on","off"]);
 app.mutate("task/updateTaskAlert",["p","end",null]);
 assert.equal(task(app,"p").alert_end,null);
 const generation=task(app,"p").recurrence_generation;
 app.mutate("task/updateTaskAlert",["p","end","on"]);
 assert.equal(task(app,"p").recurrence_generation,generation);
 for(const bad of [["middle","on"],["end","yes"],["end",true],[undefined,"on"]])
  assert.throws(()=>app.mutate("task/updateTaskAlert",["p",...bad]),/INVALID_ALERT/);
});

test("a copy and a restored task carry the period and the alert choices",t=>{
 const {app}=adapter(t);
 app.mutate("task/addTask",[{tid:"p",title:"P",due_date:due,start_offset:3*DAY,alert_start:"off",alert_end:"on"}]);
 app.mutate("task/duplicateTask",["p",{tid:"copy"}]);
 const copy=task(app,"copy");
 assert.deepEqual([copy.due_date,copy.start_offset,copy.alert_start,copy.alert_end],[due,3*DAY,"off","on"]);
 // A copy of a task whose due was cleared by an older app (offset left behind) has no period.
 const {expand}=require("@thread/e2ee/src/model/entities");
 const [[,[left]]]=expand("task/duplicateTask",["q",{tid:"qcopy"}],{rows:[{entityType:"task",entityId:"q",operation:"upsert",fields:{title:"Q",due_date:0,start_offset:DAY,alert_end:"bad"}}]});
 assert.deepEqual([Object.hasOwn(left,"start_offset"),Object.hasOwn(left,"alert_end")],[false,false]);
 // The undo notice's snapshot (Task.toEntity): the fields come back on a new row.
 const row=task(app,"p");
 app.mutate("task/deleteTask",["p"]);
 app.mutate("task/restoreTask",[{tid:"back",title:row.title,memo:row.memo,done:false,due_date:row.due_date,start_offset:row.start_offset,alert_start:row.alert_start,alert_end:row.alert_end,categories:[],subtasks:[]}]);
 const back=task(app,"back");
 assert.deepEqual([back.due_date,back.start_offset,back.alert_start,back.alert_end],[due,3*DAY,"off","on"]);
 // Snapshots without a period (or from before #109) restore as before; bad ones are refused.
 app.mutate("task/restoreTask",[{tid:"old",title:"Old",due_date:due,start_offset:0,alert_start:null,alert_end:null,categories:[],subtasks:[]}]);
 assert.equal(Object.hasOwn(task(app,"old"),"start_offset"),false);
 assert.throws(()=>app.mutate("task/restoreTask",[{tid:"x",title:"X",due_date:due,start_offset:-5}]),/INVALID_RESTORE/);
 assert.throws(()=>app.mutate("task/restoreTask",[{tid:"x",title:"X",due_date:due,alert_end:"maybe"}]),/INVALID_ALERT/);
});

test("completing a repeating period moves the start with the due; the done copy keeps the period; undo puts it back",t=>{
 let clock=due-DAY;
 const {app}=adapter(t,()=>clock);
 app.mutate("task/addTask",[{tid:"w",title:"Weekly",due_date:due,start_offset:3*DAY+2*H,repeat_period:"week",alert_end:"off"}]);
 const generation=task(app,"w").recurrence_generation;
 app.mutate("task/updateTaskDone",["w",true]);
 const next=task(app,"w"),copy=task(app,occurrenceID("fixture","w",generation,"task"));
 assert.equal(next.due_date,due+7*DAY);
 assert.equal(next.due_date-next.start_offset,due+7*DAY-3*DAY-2*H);
 assert.deepEqual([next.alert_end,next.done],["off",false]);
 assert.deepEqual([copy.done,copy.due_date,copy.start_offset,copy.alert_end,copy.repeat_period],[true,due,3*DAY+2*H,"off",""]);
 app.mutate("task/undoRecurringCompletion",["w",{due_date:due}]);
 assert.deepEqual([task(app,"w").due_date,task(app,"w").start_offset],[due,3*DAY+2*H]);
 // An older app completing it only patches the due: the start still follows (same row).
 clock=due;
 app.mutate("task/updateTaskDone",["w",true]);
 assert.equal(task(app,"w").due_date-task(app,"w").start_offset,due+7*DAY-3*DAY-2*H);
});

test("the period topics are open to the window and refused without an open vault",()=>{
 const {REQUEST_TOPICS}=require("../public/electron/modules/preload");
 const legacy=fs.readFileSync(path.join(__dirname,"../public/electron/configures/ipc.config.js"),"utf8");
 const {mutationTopics}=require("@thread/e2ee/src/model/entities");
 for(const topic of ["task/updateTaskPeriod","task/updateTaskAlert"]){
  assert.ok(REQUEST_TOPICS.includes(topic),topic);
  assert.ok(legacy.includes(`"${topic}",`),topic);
  assert.ok(mutationTopics.has(topic),topic);
 }
});

test("app settings keep the start group: defaults, a whole value, an older four-key value",t=>{
 const settings=require("../public/electron/modules/appSettings");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-settings-period-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const app={getPath:()=>dir};
 assert.deepEqual(settings.DEFAULTS.reminders,{enabled:true,before:true,minutes:10,due:false,startBefore:true,startMinutes:10,startAt:false});
 settings.initSettings(app);
 const all={enabled:true,before:false,minutes:30,due:true,startBefore:false,startMinutes:60,startAt:true};
 assert.deepEqual(settings.updateSettings({reminders:all}).reminders,all);
 // Four keys (an older window): the start choices stay.
 assert.deepEqual(settings.updateSettings({reminders:{enabled:true,before:true,minutes:5,due:false}}).reminders,{...all,before:true,minutes:5,due:false});
 for(const bad of [{...all,startMinutes:7},{...all,startAt:"yes"},{enabled:true,before:true,minutes:5,due:false,startAt:true},{...all,extra:1}])
  assert.throws(()=>settings.updateSettings({reminders:bad}),/INVALID_SETTINGS/);
 assert.deepEqual(settings.loadSettings(app).reminders,{...all,before:true,minutes:5,due:false});
 // A file from before #109 reads with the default start group.
 fs.writeFileSync(path.join(dir,"app-settings.json"),JSON.stringify({reminders:{enabled:true,before:false,minutes:15,due:true}}));
 assert.deepEqual(settings.loadSettings(app).reminders,{enabled:true,before:false,minutes:15,due:true,startBefore:true,startMinutes:10,startAt:false});
});

test("an offset left without a due (an older app cleared only due_date) does not come back with a new due",()=>{
 const {command}=require("@thread/e2ee/src/model/entities");
 const view=(fields)=>({rows:[{entityType:"task",entityId:"p",fields:{tid:"p",title:"P",...fields}}]});
 // What PC 2.5.x / phone 2.1.0 leave: due 0, the offset still there.
 const orphan=view({due_date:0,start_offset:3*DAY});
 assert.deepEqual(command("task/updateTaskDueDate",["p",due],orphan).changes,{due_date:due,start_offset:0});
 // The repeat a new due needs (DetailPanel sets the due first) clears it too.
 assert.equal(command("task/updateTaskDueDate",["p",due],view({due_date:0,start_offset:DAY,repeat_period:"week"})).changes.start_offset,0);
 // A period set on purpose still works; a due on a row with a due keeps its offset.
 assert.equal(command("task/updateTaskPeriod",["p",{due,start}],orphan).changes.start_offset,3*DAY);
 assert.equal(Object.hasOwn(command("task/updateTaskDueDate",["p",due+DAY],view({due_date:due,start_offset:DAY})).changes,"start_offset"),false);
});
