const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),Module=require("node:module");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const {ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");

// Synthetic local vault; no network, no user data.
function adapter(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-important-fixture-"));
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,2),scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return new ApplicationAdapter(new EncryptedReplica(store,{vaultId:"vault",epoch:"1",deviceId:"owner"}));
}
const task=(app,tid)=>app.lists().tasks.find(row=>row.tid===tid);

test("task/updateTaskImportant sets fields.important and later patches keep it",t=>{
 const app=adapter(t);
 app.mutate("task/addTask",[{tid:"plain",title:"Plain"}]);
 app.mutate("task/addTask",[{tid:"starred",title:"Starred",important:true}]);
 assert.equal(task(app,"plain").important,undefined);
 assert.equal(task(app,"starred").important,true);
 app.mutate("task/updateTaskImportant",["plain",true]);
 assert.equal(task(app,"plain").important,true);
 app.mutate("task/updateTaskTitle",["plain","Renamed"]);
 app.mutate("task/updateTaskMemo",["plain","memo"]);
 assert.equal(task(app,"plain").title,"Renamed");
 assert.equal(task(app,"plain").important,true);
 app.mutate("task/updateTaskImportant",["plain",false]);
 assert.equal(task(app,"plain").important,false);
 // Anything but a real true clears the star.
 app.mutate("task/updateTaskImportant",["starred","yes"]);
 assert.equal(task(app,"starred").important,false);
});

test("plaintext v2 never queues the star: the action is rejected and addTask drops the field",async()=>{
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
 assert.equal(await service.intercept("task/updateTaskImportant","star",["a",true]),true);
 assert.equal(queued.length,0);
 assert.deepEqual(events.find(e=>e[0]==="task/updateTaskImportant"),["task/updateTaskImportant","star",false,{syncV2Ack:true,code:"UNSUPPORTED_V2_ACTION"}]);
 assert.equal(await service.intercept("task/addTask","add",[{tid:"b",title:"New",important:true}]),true);
 assert.equal(queued.length,1);
 assert.equal(queued[0].changes.title,"New");
 assert.equal(Object.hasOwn(queued[0].changes,"important"),false);
});
