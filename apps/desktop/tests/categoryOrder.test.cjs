const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),Module=require("node:module");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const {ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
require("../public/electron/e2ee/platform");
const {optimistic,identity}=require("@thread/e2ee/src/model/optimistic");

// Synthetic local vault; no network, no user data.
function adapter(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-category-order-"));
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,2),scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const replica=new EncryptedReplica(store,{vaultId:"vault",epoch:"1",deviceId:"owner"});
 return {app:new ApplicationAdapter(replica),replica};
}
const order=app=>app.lists().categories.map(row=>row.cid);
const category=(app,cid)=>app.lists().categories.find(row=>row.cid===cid);

test("category/updateCategoryOrder moves a category and the rank survives other patches",t=>{
 const {app}=adapter(t);
 for(const [cid,created_at] of [["a",100],["b",200],["c",300],["d",400]])app.mutate("category/createCategory",[{cid,title:cid.toUpperCase(),created_at}]);
 assert.deepEqual(order(app),["a","b","c","d"]);
 // A create appends a rank.
 assert.equal(category(app,"d").sort_rank,String(4n*4294967296n));
 app.mutate("category/updateCategoryOrder",["d","a",false]);
 assert.deepEqual(order(app),["d","a","b","c"]);
 app.mutate("category/updateCategoryOrder",["a","c",true]);
 assert.deepEqual(order(app),["d","b","c","a"]);
 app.mutate("category/updateCategoryTitle",["a","Renamed"]);
 app.mutate("category/updateCategoryColor",["a","#44c98b"]);
 assert.deepEqual(order(app),["d","b","c","a"]);
 assert.equal(category(app,"a").title,"Renamed");
 // Self anchor is a no-op; a missing anchor or category is rejected.
 assert.equal(app.mutate("category/updateCategoryOrder",["b","b",true]),null);
 assert.throws(()=>app.mutate("category/updateCategoryOrder",["b","gone",true]),/ANCHOR_DELETED/);
 assert.throws(()=>app.mutate("category/updateCategoryOrder",["gone","b",true]),/ENTITY_DELETED/);
 // A new category goes to the end of the user's order, not by created_at.
 app.mutate("category/createCategory",[{cid:"e",title:"E",created_at:1}]);
 assert.deepEqual(order(app),["d","b","c","a","e"]);
 // Task order is untouched by category moves.
 app.mutate("task/addTask",[{tid:"t1",title:"T1"}]);app.mutate("task/addTask",[{tid:"t2",title:"T2"}]);
 app.mutate("category/updateCategoryOrder",["e","d",false]);
 assert.deepEqual(app.lists().tasks.map(row=>row.tid),["t1","t2"]);
 assert.deepEqual(order(app),["e","d","b","c","a"]);
});

test("categories without sort_rank (older clients) keep created_at order and get ranks on the first move",()=>{
 // Rows as an older client writes them: no sort_rank on categories.
 const rows=new Map();
 for(const [cid,created_at] of [["old2",200],["old1",100],["old3",300]]){
  const row={entityType:"category",entityId:cid,operation:"upsert",version:"1",fields:{title:cid,secret:false,locked:false,color:"",created_at}};
  rows.set(identity(row),row);
 }
 const {entityLists}=require("../public/electron/sync-v2/entities");
 assert.deepEqual(entityLists({rows:[...rows.values()]}).categories.map(row=>row.cid),["old1","old2","old3"]);
 optimistic(rows,{entityType:"category",entityId:"old3",operation:"move",anchorId:"old1",after:false,localTime:500});
 const lists=entityLists({rows:[...rows.values()]});
 assert.deepEqual(lists.categories.map(row=>row.cid),["old3","old1","old2"]);
 assert.ok(lists.categories.every(row=>/^[1-9][0-9]*$/.test(row.sort_rank)));
 // A category an older client adds later (no rank) shows after the ranked ones.
 const late={entityType:"category",entityId:"late",operation:"upsert",version:"1",fields:{title:"late",created_at:50}};
 rows.set(identity(late),late);
 assert.deepEqual(entityLists({rows:[...rows.values()]}).categories.map(row=>row.cid),["old3","old1","old2","late"]);
});

test("one move queues the moved row plus any rows it had to rank, in one change set",t=>{
 const {app,replica}=adapter(t);
 for(const cid of ["a","b","c"])app.mutate("category/createCategory",[{cid,title:cid,created_at:1}]);
 const before=replica.status().pending;
 assert.ok(app.mutate("category/updateCategoryOrder",["c","a",false]));
 assert.equal(replica.status().pending,before+1);
});

test("a move of ranked categories changes only the moved row; ranks are rebuilt only without room",t=>{
 const {app,replica}=adapter(t);
 for(const cid of ["a","b","c","d"])app.mutate("category/createCategory",[{cid,title:cid,created_at:1}]);
 const ranks=()=>Object.fromEntries(app.lists().categories.map(row=>[row.cid,row.sort_rank]));
 const before=ranks();
 app.mutate("category/updateCategoryOrder",["d","a",true]);
 assert.equal(replica.pending().at(-1).value.changes.length,1);
 assert.deepEqual(order(app),["a","d","b","c"]);
 const after=ranks();
 for(const cid of ["a","b","c"])assert.equal(after[cid],before[cid]);
 // A create appends after the last rank without touching the others.
 app.mutate("category/createCategory",[{cid:"e",title:"e",created_at:1}]);
 assert.equal(replica.pending().at(-1).value.changes.length,1);
 // Neighbours with no rank between them: everything is re-ranked once.
 const rows=new Map();
 for(const [cid,rank] of [["x","1"],["y","2"],["z","3"]]){
  const row={entityType:"category",entityId:cid,operation:"upsert",version:"1",fields:{title:cid,created_at:1,sort_rank:rank}};
  rows.set(identity(row),row);
 }
 optimistic(rows,{entityType:"category",entityId:"z",operation:"move",anchorId:"y",after:false,localTime:5});
 const {entityLists}=require("../public/electron/sync-v2/entities");
 const lists=entityLists({rows:[...rows.values()]}).categories;
 assert.deepEqual(lists.map(row=>row.cid),["x","z","y"]);
 assert.equal(new Set(lists.map(row=>row.sort_rank)).size,3);
 // Unranked rows (older clients) get ranks after the ranked ones; ranked rows stay.
 const mixed=new Map();
 for(const [cid,rank,created_at] of [["r1","100",1],["r2","200",2],["u1",undefined,3],["u2",undefined,4]]){
  const row={entityType:"category",entityId:cid,operation:"upsert",version:"1",fields:{title:cid,created_at,...(rank?{sort_rank:rank}:{})}};
  mixed.set(identity(row),row);
 }
 const r1=mixed.get(identity({entityType:"category",entityId:"r1"}));
 optimistic(mixed,{entityType:"category",entityId:"u2",operation:"move",anchorId:"r1",after:true,localTime:5});
 assert.equal(mixed.get(identity({entityType:"category",entityId:"r1"})),r1);
 assert.deepEqual(entityLists({rows:[...mixed.values()]}).categories.map(row=>row.cid),["r1","u2","r2","u1"]);
});

test("plaintext v2 never queues a category move",async()=>{
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
  view:async()=>({rows:[],pending:[],epoch:null}),meta:async()=>undefined}});
 assert.equal(await service.intercept("category/updateCategoryOrder","move",["a","b",true]),true);
 assert.equal(queued.length,0);
 assert.deepEqual(events.find(e=>e[0]==="category/updateCategoryOrder"),["category/updateCategoryOrder","move",false,{syncV2Ack:true,code:"UNSUPPORTED_V2_ACTION"}]);
 // A create request never carries sort_rank to the plaintext server.
 assert.equal(await service.intercept("category/createCategory","create",[{cid:"c",title:"C",sort_rank:"5",created_at:1}]),true);
 assert.equal(queued.length,1);
 assert.equal(Object.hasOwn(queued[0].changes,"sort_rank"),false);
});
