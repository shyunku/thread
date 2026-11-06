const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
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
