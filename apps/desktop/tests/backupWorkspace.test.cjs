const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),workspace=require("../public/electron/e2ee/backupWorkspace");
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-backup-ui-"));
 const store=new EncryptedStore({filename:path.join(dir,"live.db"),key:Buffer.alloc(32,5),scope:{environment:"development",accountId:"synthetic",vaultId:"fixture"},create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 store.put("recovery","$owner-identity",{fingerprint:"a".repeat(64),privateKey:"DO_NOT_RENDER"});
 const task={objectId:"task1",version:"1",fields:[{slot:0,value:{entityType:"task",entityId:"task1",version:"1",fields:{title:"SYNTHETIC_TITLE",memo:"SYNTHETIC_MEMO",sort_rank:"4294967296",done:false,due_date:0,repeat_period:"",privateKey:"DO_NOT_RENDER"}}}],deleted:false};
 store.put("confirmed","task1",task);store.put("visible","task1",task);
 const filename=path.join(dir,"backup.threadbackup");let auth=0;
 const entry={applicationActive:true,abort:new AbortController(),controller:{use:fn=>fn(store)}};
 const service={busy:false,generation:0,active:entry,context:()=>entry,runtime:()=>({baseDirectory:dir,getWindow:()=>null,
  osAuth:{verify:async()=>{auth++;return true;}},dialog:{showSaveDialog:async()=>({canceled:false,filePath:filename}),showOpenDialog:async()=>({canceled:false,filePaths:[filename]})}})};
 return {dir,store,service,filename,auth:()=>auth};
}
test("backup UI service reauthenticates, preserves live data, and exposes only bounded task previews",async t=>{
 const f=fixture(t),code=await workspace.execute(f.service,"code"),input=()=>({confirmed:true,method:"os",code});
 await assert.rejects(workspace.execute(f.service,"export",{}),/CONSENT/);assert.equal(f.auth(),0);
 assert.equal(await workspace.execute(f.service,"last"),null);
 const before=Date.now();assert.equal((await workspace.execute(f.service,"export",input())).phase,"EXPORTED");
 // The settings summary shows the last successful export (time and count only).
 const last=await workspace.execute(f.service,"last");assert.deepEqual(Object.keys(last).sort(),["at","count"]);assert.ok(last.at>=before&&last.count>0);
 const restored=await workspace.execute(f.service,"restore",input());assert.equal(restored.phase,"REVIEW_REQUIRED");assert.equal(f.auth(),2);
 const list=await workspace.execute(f.service,"list");assert.equal(list.length,1);assert.deepEqual(Object.keys(list[0]).sort(),["id","phase"]);
 const page=await workspace.execute(f.service,"review",{id:restored.id});
 assert.equal(page.items.length,2);assert.deepEqual(page.items[0].content,{title:"SYNTHETIC_TITLE",memo:"SYNTHETIC_MEMO"});
 assert.equal(JSON.stringify(page).includes("DO_NOT_RENDER"),false);
 assert.equal(f.store.get("confirmed","task1").fields[0].value.fields.title,"SYNTHETIC_TITLE");
 await assert.rejects(workspace.execute(f.service,"review",{id:"../../live"}),/BACKUP_NOT_FOUND|INVALID_BACKUP_ID/);
 await assert.rejects(workspace.execute(f.service,"export",input()),/TARGET_EXISTS/);
});
test("restoring copies creates new task IDs only once and never installs archived identity",async t=>{
 const f=fixture(t),{EncryptedReplica}=require("../public/electron/e2ee/replica"),{ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
 const replica=new EncryptedReplica(f.store,{vaultId:"fixture",epoch:"1",deviceId:"new"});
 const code=await workspace.execute(f.service,"code"),input=()=>({confirmed:true,method:"os",code});
 await workspace.execute(f.service,"export",input());const imported=await workspace.execute(f.service,"restore",input());
 const before=f.store.get("recovery","$owner-identity");
 const first=await workspace.execute(f.service,"apply",{confirmed:true,method:"os",id:imported.id});
 assert.equal(first.phase,"COPIES_QUEUED");
 const tasks=new ApplicationAdapter(replica).lists().tasks;assert.equal(tasks.length,2);
 assert.equal(tasks.some(task=>task.tid==="task1"),true);assert.equal(new Set(tasks.map(task=>task.tid)).size,2);
 assert.deepEqual(await workspace.execute(f.service,"apply",{confirmed:true,method:"os",id:imported.id}),first);
 assert.equal(new ApplicationAdapter(replica).lists().tasks.length,2);
 assert.deepEqual(f.store.get("recovery","$owner-identity"),before);
});
test("account change during native file dialog prevents exporting",async t=>{
 const f=fixture(t),runtime=f.service.runtime();
 runtime.dialog.showSaveDialog=async()=>{f.service.generation++;return {canceled:false,filePath:f.filename};};
 f.service.runtime=()=>runtime;
 await assert.rejects(workspace.execute(f.service,"export",{confirmed:true,method:"os",code:await workspace.execute(f.service,"code")}),/SESSION_CHANGED/);
 assert.equal(fs.existsSync(f.filename),false);assert.equal(f.service.busy,false);
});
