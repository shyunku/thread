const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const {ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
require("../public/electron/e2ee/platform");

// Synthetic local vault; no network, no user data.
function adapter(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-unknown-rows-"));
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,3),scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const replica=new EncryptedReplica(store,{vaultId:"vault",epoch:"1",deviceId:"owner"});
 return {app:new ApplicationAdapter(replica),replica,store};
}
// A row a newer app writes (#77 device names); this version does not know the type.
const put=(replica,objectId,row)=>replica.enqueue([{objectId,baseVersion:"0",deleted:false,fields:[{slot:0,value:row}]}]);

test("a row of an unknown type is left alone: lists, edits and other rows keep working (#77)",t=>{
 const {app,replica,store}=adapter(t);
 app.mutate("category/createCategory",[{cid:"c1",title:"업무"}]);
 app.mutate("task/addTask",[{tid:"t1",title:"할 일",categories:["c1"]}]);
 put(replica,"newerRow",{entityType:"deviceName",entityId:"device-1",operation:"create",fields:{name:"Galaxy S24"}});
 const lists=app.lists();
 assert.deepEqual(lists.tasks.map(row=>row.tid),["t1"]);
 assert.deepEqual(lists.categories.map(row=>row.cid),["c1"]);
 app.mutate("task/updateTaskTitle",["t1","바뀐 할 일"]);
 assert.equal(app.lists().tasks[0].title,"바뀐 할 일");
 // Never rewritten: the stored row is the one the newer app wrote.
 assert.equal(store.get("visible","newerRow").fields[0].value.fields.name,"Galaxy S24");
});

test("a malformed row still stops the lists",t=>{
 const {app,replica}=adapter(t);
 put(replica,"broken",{entityType:"deviceName",fields:{name:"x"}});
 assert.throws(()=>app.lists(),/INVALID_APPLICATION_OBJECT/);
});
