const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{EventEmitter}=require("node:events");
const {VaultWorkspaceService}=require("../public/electron/e2ee/workspaceService");
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-workspace-")),window=new EventEmitter(),power=new EventEmitter(),events=[];let uid="fixture";
 window.webContents=new EventEmitter();power.getSystemIdleTime=()=>0;
 const deps={enabled:true,baseDirectory:dir,environment:"development",getAccount:()=>uid,getWindow:()=>window,powerMonitor:power,
  protector:{protect:key=>Buffer.from(key),unprotect:bytes=>Buffer.from(bytes)},osAuth:{availability:async()=>true,verify:async()=>true},notify:data=>events.push(data)};
 const service=new VaultWorkspaceService(deps);
 t.after(()=>{service.reset();fs.rmSync(dir,{recursive:true,force:true});});
 return {service,deps,window,power,events,dir,switchAccount:value=>{service.reset();uid=value;}};
}
test("actual workspace creation, password reopen, lock and account isolation preserve existing files",async t=>{
 const f=fixture(t),s=f.service;
 assert.equal((await s.status()).phase,"ABSENT");assert.deepEqual(fs.readdirSync(f.dir),[]);
 assert.equal((await s.create("synthetic test password")).phase,"LOCKED");
 await assert.rejects(s.create("synthetic test password"),/EXISTS/);
 assert.equal((await s.unlock("password","synthetic test password")).phase,"UNLOCKED");
 assert.deepEqual(s.intakes(),[]);
 f.power.emit("lock-screen");assert.throws(()=>s.intakes(),/LOCKED/);
 await assert.rejects(s.unlock("password","wrong"),/./);
 assert.equal((await s.unlock("os")).phase,"UNLOCKED");
 const before=fs.readdirSync(f.dir);f.switchAccount("other");
 assert.equal((await s.status()).phase,"ABSENT");assert.deepEqual(fs.readdirSync(f.dir),before);
 f.switchAccount("fixture");assert.equal((await s.status()).phase,"LOCKED");
 assert.equal((await s.unlock("password","synthetic test password")).phase,"UNLOCKED");
 f.window.webContents.emit("render-process-gone");
 assert.throws(()=>s.intakes(),/LOCKED/);
});
test("late OS authentication cannot reopen a switched account; packaged gate creates no files",async t=>{
 const f=fixture(t);await f.service.create("synthetic test password");
 let finish;f.deps.osAuth.verify=()=>new Promise(resolve=>{finish=resolve;});
 const pending=f.service.unlock("os");f.switchAccount("other");finish(true);
 await assert.rejects(pending);assert.equal((await f.service.status()).phase,"ABSENT");
 f.deps.enabled=false;assert.deepEqual(await f.service.status(),{enabled:false});
 await assert.rejects(f.service.create("synthetic test password"),/NOT_ENABLED/);
});
