const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const {ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
const {command,mutationTopics}=require("@thread/e2ee/src/model/entities");
const {planReminders}=require("@thread/e2ee/src/model/reminders");

// Synthetic local vault; no network, no user data.
function adapter(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-category-secret-"));
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,2),scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const replica=new EncryptedReplica(store,{vaultId:"vault",epoch:"1",deviceId:"owner"});
 return {app:new ApplicationAdapter(replica),replica};
}
const category=(app,cid)=>app.lists().categories.find(row=>row.cid===cid);

test("category/updateCategorySecret is a mutation that patches secret and locked together",()=>{
 assert.ok(mutationTopics.has("category/updateCategorySecret"));
 assert.deepEqual(command("category/updateCategorySecret",["c",true]),{entityType:"category",entityId:"c",operation:"patch",changes:{secret:true,locked:true},parentId:undefined});
 // Only a real true makes it secret.
 for(const value of [false,"yes",1,undefined])
  assert.deepEqual(command("category/updateCategorySecret",["c",value]).changes,{secret:false,locked:false});
});

test("a category turns secret and back; title, colour, order and its tasks stay",t=>{
 const {app,replica}=adapter(t);
 app.mutate("category/createCategory",[{cid:"work",title:"Work",color:"#6294ff",created_at:100}]);
 app.mutate("category/createCategory",[{cid:"life",title:"Life",color:"#44c98b",created_at:200}]);
 app.mutate("category/updateCategoryOrder",["life","work",false]);
 app.mutate("task/addTask",[{tid:"t1",title:"Task",categories:["work"]}]);
 const before=category(app,"work");
 assert.equal(before.secret,false);
 const pending=replica.status().pending;
 assert.ok(app.mutate("category/updateCategorySecret",["work",true]));
 // One change: only the category row.
 assert.equal(replica.status().pending,pending+1);
 assert.equal(replica.pending().at(-1).value.changes.length,1);
 const secret=category(app,"work");
 assert.equal(secret.secret,true);
 assert.equal(secret.locked,true);
 for(const key of ["title","color","created_at","sort_rank"])assert.equal(secret[key],before[key]);
 assert.deepEqual(app.lists().categories.map(row=>row.cid),["life","work"]);
 assert.deepEqual(app.lists().relations,[{tid:"t1",cid:"work"}]);
 app.mutate("category/updateCategorySecret",["work",false]);
 assert.equal(category(app,"work").secret,false);
 assert.equal(category(app,"work").locked,false);
 // Later patches keep the flag.
 app.mutate("category/updateCategorySecret",["life",true]);
 app.mutate("category/updateCategoryTitle",["life","Diary"]);
 app.mutate("category/updateCategoryColor",["life","#e57ad6"]);
 assert.equal(category(app,"life").secret,true);
 // A deleted (or unknown) category is refused.
 app.mutate("category/deleteCategory",["life"]);
 assert.throws(()=>app.mutate("category/updateCategorySecret",["life",false]),/ENTITY_DELETED/);
 assert.throws(()=>app.mutate("category/updateCategorySecret",["gone",true]),/ENTITY_DELETED/);
});

test("due reminders follow the flag: a task's title is left out once its category is secret",t=>{
 const {app}=adapter(t);
 const now=Date.UTC(2026,10,4,1,0),due=now+60*60000;
 app.mutate("category/createCategory",[{cid:"work",title:"Work",created_at:1}]);
 app.mutate("task/addTask",[{tid:"t1",title:"Report",due_date:due,categories:["work"]}]);
 const titles=()=>planReminders(app.lists(),{enabled:true,before:true,minutes:10,due:false},{now}).map(item=>item.title);
 assert.deepEqual(titles(),["Report"]);
 app.mutate("category/updateCategorySecret",["work",true]);
 assert.deepEqual(titles(),[null]);
 app.mutate("category/updateCategorySecret",["work",false]);
 assert.deepEqual(titles(),["Report"]);
});

test("the renderer may send it and it is refused without an open vault",()=>{
 const preload=fs.readFileSync(path.join(__dirname,"../public/electron/modules/preload.js"),"utf8");
 assert.match(preload,/"category\/updateCategorySecret"/);
 const ipc=fs.readFileSync(path.join(__dirname,"../public/electron/configures/ipc.config.js"),"utf8");
 const refused=ipc.match(/for \(const topic of \[([^\]]*)\]\) \{\s*s\.register\(topic, async \(event, reqId\) => \{\s*s\.sender\(topic, reqId, false, \{ code: "E2EE_APPLICATION_REQUIRED" \}\)/);
 assert.ok(refused);
 assert.match(refused[1],/"category\/updateCategorySecret"/);
});
