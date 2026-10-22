const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{EventEmitter}=require("node:events");
const {VaultWorkspaceService}=require("../public/electron/e2ee/workspaceService");
const {vaultIpcReply}=require("../public/electron/e2ee/vaultIpcReply");
// Synthetic vault with a stubbed OS auth; no real Windows Hello prompt.
function fixture(t,{osAvailable=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-verify-user-")),window=new EventEmitter(),power=new EventEmitter(),events=[],calls=[];
 window.webContents=new EventEmitter();power.getSystemIdleTime=()=>0;
 const osAuth={available:osAvailable,answer:async()=>true,availability:async()=>osAuth.available,verify:async w=>{calls.push(w);return osAuth.answer();}};
 const deps={enabled:true,baseDirectory:dir,environment:"development",getAccount:()=>"fixture",getWindow:()=>window,powerMonitor:power,
  protector:{protect:key=>Buffer.from(key),unprotect:bytes=>Buffer.from(bytes)},osAuth,notify:data=>events.push(data)};
 const service=new VaultWorkspaceService(deps);
 t.after(()=>{service.reset();fs.rmSync(dir,{recursive:true,force:true});});
 return {service,osAuth,calls,events,window,power};
}
const PASSWORD="synthetic verify password";

test("verifyUser uses OS auth when the vault opens with it, and refuses while locked",async t=>{
 const f=fixture(t),s=f.service;
 await s.create({method:"os"});f.calls.length=0;
 await assert.rejects(s.verifyUser({}),/VAULT_LOCKED/);
 assert.equal(f.calls.length,0);
 await s.unlock("os");f.calls.length=0;
 assert.deepEqual(await s.verifyUser({}),{verified:true,method:"os"});
 assert.deepEqual(f.calls,[f.window]);
 // A cancelled or failed prompt is an answer, not an error; the vault stays open.
 f.osAuth.answer=async()=>{throw Error("OS_AUTH_CANCELLED");};
 assert.deepEqual(await s.verifyUser(),{verified:false,method:"os",code:"OS_AUTH_CANCELLED",osAvailable:true,passwordAvailable:false});
 f.osAuth.answer=async()=>false;
 assert.equal((await s.verifyUser()).code,"OS_AUTH_CANCELLED");
 f.osAuth.answer=async()=>{throw Error("synthetic helper text");};
 assert.equal((await s.verifyUser()).code,"OS_AUTH_FAILED");
 assert.equal((await s.status()).phase,"UNLOCKED");
 // This vault has no password, so there is no password fallback.
 assert.equal((await s.verifyUser({method:"password",password:PASSWORD})).code,"PASSWORD_UNAVAILABLE");
 await assert.rejects(s.verifyUser({method:"pin"}),/INVALID_AUTH_METHOD/);
 // Locking ends it: the renderer hears LOCKED and verify refuses again.
 s.lock();
 assert.equal(f.events.at(-1).phase,"LOCKED");
 await assert.rejects(s.verifyUser({}),/VAULT_LOCKED/);
});

test("verifyUser falls back to the vault password when OS auth is not available",async t=>{
 const f=fixture(t,{osAvailable:false}),s=f.service;
 await s.create(PASSWORD);await s.unlock("password",PASSWORD);
 const input={password:PASSWORD};
 assert.deepEqual(await s.verifyUser(input),{verified:true,method:"password"});
 assert.equal(input.password,undefined);
 assert.equal(f.calls.length,0);
 assert.deepEqual(await s.verifyUser({password:"wrong"}),{verified:false,method:"password",code:"PASSWORD_REJECTED",osAvailable:false,passwordAvailable:true});
 assert.equal((await s.verifyUser({})).code,"PASSWORD_REJECTED");
 assert.equal((await s.verifyUser({method:"os"})).code,"OS_AUTH_UNAVAILABLE");
 // Still unlocked and usable after a wrong password.
 assert.deepEqual(s.intakes(),[]);
});

test("a password vault with OS auth verifies with OS auth by default and the password on request",async t=>{
 const f=fixture(t),s=f.service;
 await s.create(PASSWORD);await s.unlock("os");
 assert.deepEqual(await s.verifyUser(),{verified:true,method:"os"});
 assert.deepEqual(await s.verifyUser({method:"password",password:PASSWORD}),{verified:true,method:"password"});
 assert.equal(f.calls.length,2);// unlock + the default verify
});

test("a lock during the prompt makes a late success fail",async t=>{
 const f=fixture(t),s=f.service;
 await s.create({method:"os"});await s.unlock("os");
 let finish;f.osAuth.answer=()=>new Promise(resolve=>{finish=resolve;});
 const pending=s.verifyUser();
 await new Promise(resolve=>setImmediate(resolve));
 f.power.emit("lock-screen");finish(true);
 await assert.rejects(pending,/VAULT_SESSION_CHANGED|LOCKED/);
});

test("verifyUser runs one prompt at a time and waits for another vault action to finish",async t=>{
 const f=fixture(t),s=f.service;
 await s.create({method:"os"});await s.unlock("os");f.calls.length=0;
 let finish;f.osAuth.answer=()=>new Promise(resolve=>{finish=resolve;});
 const first=s.verifyUser();
 await new Promise(resolve=>setImmediate(resolve));
 // A second call while the first prompt is open answers BUSY without a second prompt.
 const input={password:PASSWORD};
 assert.deepEqual(await s.verifyUser(input),{verified:false,code:"BUSY"});
 assert.equal(input.password,undefined);
 assert.equal(f.calls.length,1);
 // The prompt holds the vault like unlock or pairing does.
 await assert.rejects(s.unlock("os"),/VAULT_BUSY/);
 finish(true);
 assert.deepEqual(await first,{verified:true,method:"os"});
 assert.equal(s.busy,false);
 // While a sync or pairing holds the vault, verify waits for it instead of overlapping.
 f.osAuth.answer=async()=>true;s.busy=true;
 const waiting=s.verifyUser();
 await new Promise(resolve=>setTimeout(resolve,150));
 assert.equal(f.calls.length,1);
 s.busy=false;
 assert.deepEqual(await waiting,{verified:true,method:"os"});
 assert.equal(f.calls.length,2);
});

test("vault/verifyUser replies through the vault IPC wrapper without leaking error text",async t=>{
 const f=fixture(t),s=f.service;
 await s.create({method:"os"});
 const ipc={userService:{getCurrent:()=>"fixture"}};
 assert.deepEqual(await vaultIpcReply(ipc,"vault/verifyUser",input=>s.verifyUser(input),[{}]),{success:false,data:{code:"VAULT_ACTION_FAILED"}});
 await s.unlock("os");
 assert.deepEqual(await vaultIpcReply(ipc,"vault/verifyUser",input=>s.verifyUser(input),[{}]),{success:true,data:{verified:true,method:"os"}});
 const contract=require("../public/electron/modules/preload");
 assert.ok(contract.REQUEST_TOPICS.includes("vault/verifyUser"));
 assert.equal(contract.REQUEST_TOPICS.includes("category/checkCategoryPassword"),false);
 for(const topic of ["category/updateCategoryOrder","task/duplicateTask","category/deleteCategoryInUse","category/deleteCategoryWithTasks"])assert.ok(contract.REQUEST_TOPICS.includes(topic),topic);
 assert.equal(require("../public/electron/modules/windowSecurity").canRequest("popup","vault/verifyUser"),false);
});
