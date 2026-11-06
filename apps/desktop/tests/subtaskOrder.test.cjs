const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const {ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
require("../public/electron/e2ee/platform");
const {optimistic,identity,compareSubtasks}=require("@thread/e2ee/src/model/optimistic");
const {entityLists,expand}=require("@thread/e2ee/src/model/entities");

// Synthetic local vault; no network, no user data.
function adapter(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-subtask-order-"));
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,2),scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const replica=new EncryptedReplica(store,{vaultId:"vault",epoch:"1",deviceId:"owner"});
 return {app:new ApplicationAdapter(replica),replica};
}
const order=(app,tid)=>app.lists().subtasks.filter(row=>row.tid===tid).map(row=>row.sid);
const subtask=(app,sid)=>app.lists().subtasks.find(row=>row.sid===sid);
const withSubtasks=(app,tid,list)=>{
 app.mutate("task/addTask",[{tid,title:tid}]);
 for(const [sid,created_at] of list)app.mutate("task/createSubtask",[{sid,title:sid,created_at},tid]);
};
// Rows as stored, for the model-only cases.
const rowMap=list=>{
 const rows=new Map();
 for(const row of list)rows.set(identity(row),{operation:"upsert",version:"1",...row});
 return rows;
};
const sub=(sid,tid,fields)=>({entityType:"subtask",entityId:sid,parentId:tid,fields:{title:sid,done:false,done_at:0,due_date:0,...fields}});
const listed=(rows,tid)=>entityLists({rows:[...rows.values()]}).subtasks.filter(row=>row.tid===tid).map(row=>row.sid);

test("task/updateSubtaskOrder moves a subtask within its task and the rank survives other patches",t=>{
 const {app}=adapter(t);
 withSubtasks(app,"t1",[["a",100],["b",200],["c",300],["d",400]]);
 // Never moved: created_at order, no ranks written.
 assert.deepEqual(order(app,"t1"),["a","b","c","d"]);
 assert.ok(app.lists().subtasks.every(row=>row.sort_rank===undefined));
 app.mutate("task/updateSubtaskOrder",["t1","d","a",false]);
 assert.deepEqual(order(app,"t1"),["d","a","b","c"]);
 app.mutate("task/updateSubtaskOrder",["t1","a","c",true]);
 assert.deepEqual(order(app,"t1"),["d","b","c","a"]);
 app.mutate("task/updateSubtaskTitle",["t1","a","Renamed"]);
 app.mutate("task/updateSubtaskDone",["t1","a",true,500]);
 app.mutate("task/updateSubtaskDueDate",["t1","a",Date.UTC(2026,10,5)]);
 assert.deepEqual(order(app,"t1"),["d","b","c","a"]);
 assert.equal(subtask(app,"a").title,"Renamed");
 // A new subtask goes to the end of the user's order, even with an older created_at.
 app.mutate("task/createSubtask",[{sid:"e",title:"e",created_at:1},"t1"]);
 assert.deepEqual(order(app,"t1"),["d","b","c","a","e"]);
 // Self anchor is a no-op; a missing anchor or subtask is rejected.
 assert.equal(app.mutate("task/updateSubtaskOrder",["t1","b","b",true]),null);
 assert.throws(()=>app.mutate("task/updateSubtaskOrder",["t1","b","gone",true]),/ANCHOR_DELETED/);
 assert.throws(()=>app.mutate("task/updateSubtaskOrder",["t1","gone","b",true]),/ENTITY_DELETED/);
 app.mutate("task/deleteSubtask",["t1","c"]);
 assert.throws(()=>app.mutate("task/updateSubtaskOrder",["t1","b","c",true]),/ANCHOR_DELETED/);
 app.mutate("task/deleteTask",["t1"]);
 assert.throws(()=>app.mutate("task/updateSubtaskOrder",["t1","b","d",true]),/PARENT_DELETED/);
});

test("ranks are scoped to the task: another task's subtask is no anchor and keeps its order",t=>{
 const {app}=adapter(t);
 withSubtasks(app,"t1",[["a",100],["b",200]]);
 withSubtasks(app,"t2",[["x",150],["y",250],["z",350]]);
 assert.throws(()=>app.mutate("task/updateSubtaskOrder",["t1","a","y",true]),/ANCHOR_DELETED/);
 app.mutate("task/updateSubtaskOrder",["t1","b","a",false]);
 assert.deepEqual(order(app,"t1"),["b","a"]);
 // t2's rows are not ranked by a move in t1.
 assert.deepEqual(order(app,"t2"),["x","y","z"]);
 assert.ok(["x","y","z"].every(sid=>subtask(app,sid).sort_rank===undefined));
 app.mutate("task/updateSubtaskOrder",["t2","x","z",true]);
 assert.deepEqual(order(app,"t2"),["y","z","x"]);
 assert.deepEqual(order(app,"t1"),["b","a"]);
 // Task order is untouched by subtask moves.
 assert.deepEqual(app.lists().tasks.map(row=>row.tid),["t1","t2"]);
});

test("one move queues the moved row plus the rows it had to rank, in one change set",t=>{
 const {app,replica}=adapter(t);
 withSubtasks(app,"t1",[["a",1],["b",2],["c",3]]);
 const before=replica.status().pending;
 assert.ok(app.mutate("task/updateSubtaskOrder",["t1","c","a",false]));
 assert.equal(replica.status().pending,before+1);
 // a and b get ranks for the first time; c is the move.
 assert.equal(replica.pending().at(-1).value.changes.length,3);
 // Ranked now: the next move changes only the moved row.
 app.mutate("task/updateSubtaskOrder",["t1","a","b",true]);
 assert.equal(replica.pending().at(-1).value.changes.length,1);
 assert.deepEqual(order(app,"t1"),["c","b","a"]);
 // A create next to ranked siblings appends a rank without touching them.
 app.mutate("task/createSubtask",[{sid:"d",title:"d",created_at:4},"t1"]);
 assert.equal(replica.pending().at(-1).value.changes.length,1);
 assert.match(subtask(app,"d").sort_rank,/^[1-9][0-9]*$/);
 assert.deepEqual(order(app,"t1"),["c","b","a","d"]);
});

test("subtasks without sort_rank (older clients) keep created_at order and are ranked on the first move",()=>{
 const rows=rowMap([
  {entityType:"task",entityId:"t1",fields:{title:"t1",sort_rank:"1"}},
  sub("old2","t1",{created_at:200}),sub("old1","t1",{created_at:100}),sub("old3","t1",{created_at:300}),
 ]);
 assert.deepEqual(listed(rows,"t1"),["old1","old2","old3"]);
 optimistic(rows,{entityType:"subtask",entityId:"old3",parentId:"t1",operation:"move",anchorId:"old1",after:false,localTime:500});
 const lists=entityLists({rows:[...rows.values()]}).subtasks;
 assert.deepEqual(lists.map(row=>row.sid),["old3","old1","old2"]);
 assert.ok(lists.every(row=>/^[1-9][0-9]*$/.test(row.sort_rank)));
 // A subtask an older client adds later (no rank) shows after the ranked ones.
 const late=sub("late","t1",{created_at:50});
 rows.set(identity(late),{operation:"upsert",version:"1",...late});
 assert.deepEqual(listed(rows,"t1"),["old3","old1","old2","late"]);
 // Same tie-break with equal created_at: the id.
 const same=rowMap([sub("b","t1",{created_at:1}),sub("a","t1",{created_at:1})]);
 assert.deepEqual(listed(same,"t1"),["a","b"]);
});

test("a move of ranked subtasks changes only the moved row; ranks are rebuilt only without room",()=>{
 const task={entityType:"task",entityId:"t1",fields:{title:"t1",sort_rank:"1"}};
 // Neighbours with no rank between them: everything in the task is re-ranked once.
 const rows=rowMap([task,sub("x","t1",{created_at:1,sort_rank:"1"}),sub("y","t1",{created_at:1,sort_rank:"2"}),sub("z","t1",{created_at:1,sort_rank:"3"}),
  {entityType:"task",entityId:"t2",fields:{title:"t2",sort_rank:"2"}},sub("o","t2",{created_at:1,sort_rank:"2"})]);
 const other=rows.get(identity({entityType:"subtask",parentId:"t2",entityId:"o"}));
 optimistic(rows,{entityType:"subtask",entityId:"z",parentId:"t1",operation:"move",anchorId:"y",after:false,localTime:5});
 const lists=entityLists({rows:[...rows.values()]}).subtasks.filter(row=>row.tid==="t1");
 assert.deepEqual(lists.map(row=>row.sid),["x","z","y"]);
 assert.equal(new Set(lists.map(row=>row.sort_rank)).size,3);
 // The other task's subtask is never re-ranked.
 assert.equal(rows.get(identity({entityType:"subtask",parentId:"t2",entityId:"o"})),other);
 // Unranked rows (older clients) get ranks after the ranked ones; ranked rows stay.
 const mixed=rowMap([task,sub("r1","t1",{created_at:1,sort_rank:"100"}),sub("r2","t1",{created_at:2,sort_rank:"200"}),sub("u1","t1",{created_at:3}),sub("u2","t1",{created_at:4})]);
 const r1=mixed.get(identity({entityType:"subtask",parentId:"t1",entityId:"r1"}));
 optimistic(mixed,{entityType:"subtask",entityId:"u2",parentId:"t1",operation:"move",anchorId:"r1",after:true,localTime:5});
 assert.equal(mixed.get(identity({entityType:"subtask",parentId:"t1",entityId:"r1"})),r1);
 assert.deepEqual(listed(mixed,"t1"),["r1","u2","r2","u1"]);
});

test("two devices' concurrent moves keep both intents instead of mixing into a third order",()=>{
 const base=()=>rowMap([{entityType:"task",entityId:"t1",fields:{title:"t1",sort_rank:"1"}},
  ...["a","b","c","d"].map((sid,i)=>sub(sid,"t1",{created_at:1,sort_rank:String(BigInt(i+1)*4294967296n)}))]);
 const key=sid=>identity({entityType:"subtask",parentId:"t1",entityId:sid});
 // Device A puts d first; device B puts a after c. Each changes only its moved row.
 const pc=base(),phone=base();
 optimistic(pc,{entityType:"subtask",entityId:"d",parentId:"t1",operation:"move",anchorId:"a",after:false,localTime:5});
 optimistic(phone,{entityType:"subtask",entityId:"a",parentId:"t1",operation:"move",anchorId:"c",after:true,localTime:6});
 const original=base();
 const changed=(rows)=>[...rows.keys()].filter(k=>JSON.stringify(rows.get(k).fields.sort_rank)!==JSON.stringify(original.get(k).fields.sort_rank));
 assert.deepEqual(changed(pc),[key("d")]);
 assert.deepEqual(changed(phone),[key("a")]);
 // Both land: the merged rows show d first and a after c.
 const merged=base();
 merged.set(key("d"),pc.get(key("d")));
 merged.set(key("a"),phone.get(key("a")));
 assert.deepEqual(listed(merged,"t1"),["d","b","c","a"]);
});

test("task/duplicateTask copies the subtasks in the shown order",t=>{
 const {app}=adapter(t);
 withSubtasks(app,"t1",[["a",100],["b",200],["c",300]]);
 app.mutate("task/updateSubtaskOrder",["t1","c","a",false]);
 app.mutate("task/updateSubtaskOrder",["t1","a","b",true]);
 assert.deepEqual(order(app,"t1"),["c","b","a"]);
 const steps=expand("task/duplicateTask",["t1",{tid:"copy"}],app.view(),1000);
 assert.deepEqual(steps.slice(1).map(([,args])=>args[0].title),["c","b","a"]);
 app.mutate("task/duplicateTask",["t1",{tid:"copy"}]);
 const copies=app.lists().subtasks.filter(row=>row.tid==="copy");
 assert.deepEqual(copies.map(row=>row.title),["c","b","a"]);
 // The copies need no rank: increasing created_at keeps the order for older clients too.
 assert.ok(copies.every(row=>row.sort_rank===undefined));
});

test("a recurring completion's copy keeps the subtask order",t=>{
 const {app}=adapter(t);
 const due=Date.UTC(2026,10,5,9);
 app.mutate("task/addTask",[{tid:"r",title:"repeat",due_date:due,repeat_period:"day"}]);
 for(const [sid,created_at] of [["a",100],["b",200],["c",300]])app.mutate("task/createSubtask",[{sid,title:sid,created_at},"r"]);
 app.mutate("task/updateSubtaskOrder",["r","c","a",false]);
 assert.deepEqual(order(app,"r"),["c","a","b"]);
 app.mutate("task/updateTaskDone",["r",true]);
 const clone=app.lists().tasks.find(row=>row.tid!=="r");
 assert.ok(clone&&clone.done);
 assert.deepEqual(app.lists().subtasks.filter(row=>row.tid===clone.tid).map(row=>row.title),["c","a","b"]);
 assert.deepEqual(order(app,"r"),["c","a","b"]);
});

test("compareSubtasks orders listed rows like entityLists",()=>{
 const rows=[
  {sid:"late",created_at:300},{sid:"second",created_at:100,sort_rank:"8589934592"},
  {sid:"early",created_at:50},{sid:"first",created_at:200,sort_rank:"4294967296"},
  {sid:"bad",created_at:50,sort_rank:"x"},
 ];
 assert.deepEqual([...rows].sort(compareSubtasks).map(row=>row.sid),["first","second","bad","early","late"]);
});

test("the subtask move is allowed through the preload and refused without an open vault",()=>{
 const contract=require("../public/electron/modules/preload");
 assert.ok(contract.REQUEST_TOPICS.includes("task/updateSubtaskOrder"));
 const source=fs.readFileSync(path.join(__dirname,"../public/electron/configures/ipc.config.js"),"utf8");
 assert.match(source,/"task\/updateSubtaskOrder",[\s\S]*E2EE_APPLICATION_REQUIRED/);
});
