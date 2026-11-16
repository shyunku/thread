// The lock-screen skip at start (#111): when the first bootstrap of a run may open the vault
// without a prompt, and when it must stay locked. The skip and the lock-by-hand mark are per
// account (marks in that account's vault folder).
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{EventEmitter}=require("node:events");
const {VaultWorkspaceService}=require("../public/electron/e2ee/workspaceService");
const {createVaultController}=require("../public/electron/e2ee/vaultController");
const {vaultIpcReply}=require("../public/electron/e2ee/vaultIpcReply");
const {REQUEST_TOPICS}=require("../public/electron/modules/preload");
const settings=require("../public/electron/modules/appSettings");

// One PC: vault folders survive "restarts" (new services on the same folder). The account
// comes from a userService like in production: null until a bootstrap sets it.
function pc(t,{osAvail=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-lockskip-"));
 const state={prompts:0,osAllowed:true,unprotect:null,signedIn:new Set(["alice","bob"])};
 const services=[];
 t.after(()=>{for(const s of services)s.reset();fs.rmSync(dir,{recursive:true,force:true});});
 const start=(initial=null)=>{
  const window=new EventEmitter(),power=new EventEmitter(),events=[],user={id:initial};
  window.webContents=new EventEmitter();power.getSystemIdleTime=()=>0;
  const deps={enabled:true,baseDirectory:dir,environment:"development",getAccount:()=>user.id,getWindow:()=>window,powerMonitor:power,
   protector:{protect:key=>Buffer.from(key),unprotect:bytes=>{if(state.unprotect)throw state.unprotect;return Buffer.from(bytes);}},
   osAuth:{availability:async()=>osAvail,verify:async()=>{state.prompts++;return osAvail&&state.osAllowed;}},notify:data=>events.push(data),
   transport:{accountStatus:async()=>({accountMode:"e2ee_pending",vaultMode:"uninitialized"})},
   signedIn:async uid=>state.signedIn.has(uid)};
  const service=new VaultWorkspaceService(deps);services.push(service);
  service.group={userService:{setCurrent(id){if(user.id!==id)service.reset();user.id=id;},getCurrent:()=>user.id}};
  service.watchStart(power);
  return {service,deps,power,events,user};
 };
 return {dir,state,start};
}
const OPEN={mode:"NEW_ACCOUNT_SETUP"},LOCKED={mode:"LOCKED"};
// Makes each account's vault (OS check, or a password vault) and optionally turns its skip on.
async function accounts(p,list){
 const r=p.start();
 for(const [uid,{password,skip}] of Object.entries(list)){
  await r.service.bootstrap(uid);
  if(password)await r.service.create(password);else await r.service.create({method:"os"});
  if(skip){
   await r.service.unlock(password?"password":"os",password);
   const answer=await r.service.skipLock("on",password?{method:"password",password}:{method:"os"});
   assert.equal(answer.skipLockOnStart,true);
  }
 }
 r.service.reset();p.state.prompts=0;
}
const mark=(r,uid,name)=>r.service.vaultFor(uid).mark(name);

test("off by default: the first start shows the lock screen as before",async t=>{
 const p=pc(t);await accounts(p,{alice:{}});
 const {service:s}=p.start();
 assert.deepEqual(await s.bootstrap("alice"),LOCKED);
 assert.equal(s.active.unlocked,false);assert.equal(p.state.prompts,0);
 assert.deepEqual(await s.skipLock("get"),{skipLockOnStart:false});
});

test("on: the first bootstrap opens without a prompt and says so; later ones change nothing",async t=>{
 const p=pc(t);await accounts(p,{alice:{skip:true}});
 const {service:s,events}=p.start();
 assert.deepEqual(await s.bootstrap("alice"),OPEN);
 assert.equal(s.active.unlocked,true);assert.equal(p.state.prompts,0);
 assert.equal(events.at(-1).phase,"UNLOCKED");
 assert.deepEqual(await s.bootstrap("alice"),OPEN);
 assert.deepEqual(await s.skipLock("get"),{skipLockOnStart:true});
 // Off asks nothing; the next start shows the lock screen.
 assert.deepEqual(await s.skipLock("off"),{skipLockOnStart:false});s.reset();
 assert.deepEqual(await p.start().service.bootstrap("alice"),LOCKED);
});

test("per account: A's skip never opens B's vault (a password vault included)",async t=>{
 const p=pc(t,{osAvail:false});
 await accounts(p,{alice:{password:"synthetic alice password",skip:true},bob:{password:"synthetic bob password"}});
 let r=p.start();
 assert.deepEqual(await r.service.bootstrap("bob"),LOCKED);
 assert.equal(r.service.active.unlocked,false);r.service.reset();
 // Alice's own password vault does open (user decision: password vaults get the skip too).
 r=p.start();
 assert.deepEqual(await r.service.bootstrap("alice"),OPEN);
});

test("only the account main has signed in opens",async t=>{
 const p=pc(t);await accounts(p,{alice:{skip:true}});
 p.state.signedIn.delete("alice");
 const {service:s}=p.start();
 assert.deepEqual(await s.bootstrap("alice"),LOCKED);
 assert.equal(s.active.unlocked,false);
});

test("a lock in the same run is never undone: screen lock, suspend, 지금 잠그기",async t=>{
 const p=pc(t);await accounts(p,{alice:{skip:true}});
 for(const lock of [r=>r.power.emit("lock-screen"),r=>r.power.emit("suspend"),r=>r.service.lock()]){
  const run=p.start(),s=run.service;p.state.prompts=0;
  assert.deepEqual(await s.bootstrap("alice"),OPEN);
  lock(run);
  assert.equal(s.active.unlocked,false);
  // The LOCKED notice makes the gate bootstrap again: it stays locked.
  assert.equal(run.events.at(-1).phase,"LOCKED");
  assert.deepEqual(await s.bootstrap("alice"),LOCKED);
  assert.equal(p.state.prompts,0);
  assert.equal((await s.unlock("os")).phase,"UNLOCKED");s.reset();
 }
});

test("before the first bootstrap: a screen lock, suspend, 지금 잠그기 or logout with no account yet drops the chance",async t=>{
 const p=pc(t);await accounts(p,{alice:{skip:true}});
 for(const drop of [r=>r.power.emit("lock-screen"),r=>r.power.emit("suspend"),r=>assert.throws(()=>r.service.lock(),/AUTH_REQUIRED/),r=>r.service.dropStartOpen()]){
  const run=p.start();
  drop(run);
  assert.deepEqual(await run.service.bootstrap("alice"),LOCKED);
  assert.equal(run.service.active.unlocked,false);
  run.service.reset();
 }
 // The power listeners go once the chance is gone.
 const run=p.start();assert.equal(run.power.listenerCount("lock-screen"),1);
 assert.deepEqual(await run.service.bootstrap("alice"),OPEN);
 assert.equal(run.power.listenerCount("suspend"),1); // the controller's own
});

test("locked by hand stays locked after a restart until that vault is unlocked; another account's unlock does not clear it",async t=>{
 const p=pc(t);await accounts(p,{alice:{skip:true},bob:{skip:true}});
 let r=p.start();
 assert.deepEqual(await r.service.bootstrap("alice"),OPEN);
 r.service.lock();
 assert.equal(mark(r,"alice","locked-by-user"),true);assert.equal(mark(r,"bob","locked-by-user"),false);
 await r.service.bootstrap("bob");await r.service.unlock("os");
 assert.equal(mark(r,"alice","locked-by-user"),true);r.service.reset();
 r=p.start();
 assert.deepEqual(await r.service.bootstrap("alice"),LOCKED);
 assert.equal((await r.service.unlock("os")).phase,"UNLOCKED");
 assert.equal(mark(r,"alice","locked-by-user"),false);r.service.reset();
 r=p.start();
 assert.deepEqual(await r.service.bootstrap("alice"),OPEN);
 // A screen lock (not by hand) leaves no mark: the next start opens again.
 r.power.emit("lock-screen");r.service.reset();
 assert.equal(mark(r,"alice","locked-by-user"),false);
 assert.deepEqual(await p.start().service.bootstrap("alice"),OPEN);
});

test("a mark that cannot be read counts as a lock by hand; one that cannot be written turns the skip off, or the caller hears it",async t=>{
 const p=pc(t);await accounts(p,{alice:{skip:true}});
 let r=p.start();
 const vaultDir=fs.readdirSync(p.dir).map(name=>path.join(p.dir,name)).find(f=>fs.statSync(f).isDirectory());
 fs.mkdirSync(path.join(vaultDir,"locked-by-user"));
 assert.deepEqual(await r.service.bootstrap("alice"),LOCKED);r.service.reset();
 fs.rmSync(path.join(vaultDir,"locked-by-user"),{recursive:true});
 r=p.start();
 assert.deepEqual(await r.service.bootstrap("alice"),OPEN);
 const vault=r.service.active.vault,setMark=vault.setMark.bind(vault);
 vault.setMark=(name,on)=>{if(name==="locked-by-user")throw Error("EPERM");return setMark(name,on);};
 r.service.lock();
 assert.equal(mark(r,"alice","skip-lock"),false);assert.equal(r.service.active.unlocked,false);
 await r.service.unlock("os");await r.service.skipLock("on",{method:"os"});
 vault.setMark=()=>{throw Error("EPERM");};
 assert.throws(()=>r.service.lock(),/LOCK_MARK_FAILED/);
 assert.equal(r.service.active.unlocked,false);
});

test("a failed open answers LOCKED and keeps the vault closed",async t=>{
 const p=pc(t);await accounts(p,{alice:{skip:true}});
 p.state.unprotect=Error("DPAPI_FAILED");
 const {service:s}=p.start();
 assert.deepEqual(await s.bootstrap("alice"),LOCKED);
 assert.equal(s.active.unlocked,false);assert.throws(()=>s.active.controller.use(()=>{}),/LOCKED/);
 p.state.unprotect=null;
 assert.deepEqual(await s.bootstrap("alice"),LOCKED);
});

test("the renderer cannot ask for the start open",async t=>{
 const p=pc(t);await accounts(p,{alice:{skip:true}});
 const {service:s}=p.start("alice");s.userService={getCurrent:()=>"alice"};
 s.context();
 for(const method of ["start","START",{method:"start"},undefined]){
  const reply=await vaultIpcReply(s,"vault/unlock",(m,pw,remember)=>s.unlock(m,pw,remember),[method]);
  assert.equal(reply.success,false);
 }
 const odd=await vaultIpcReply(s,"vault/skipLock",(action,input)=>s.skipLock(action,input),["start",{}]);
 assert.equal(odd.success,false);
 assert.equal(s.active.unlocked,false);
 assert.equal(REQUEST_TOPICS.some(topic=>/start|resume|openAtStart/i.test(topic)),false);
 assert.equal(REQUEST_TOPICS.includes("vault/skipLock"),true);
 // The controller takes "os" and "password" only.
 const power=new EventEmitter();power.getSystemIdleTime=()=>0;
 const c=createVaultController({vault:{open:()=>({close(){}}),openWithPassword:async()=>({close(){}})},osAuth:{verify:async()=>false},getWindow:()=>({}),clearRenderer(){},powerMonitor:power});
 t.after(()=>c.dispose());
 await assert.rejects(c.unlock("start"),/INVALID_UNLOCK_METHOD/);
 await assert.rejects(c.unlock("os"),/REAUTH_REQUIRED/);
 assert.equal(await c.openAtStart(),true);
});

test("turning it on confirms the user; the lock screen's check turns it on with the unlock",async t=>{
 const p=pc(t);await accounts(p,{alice:{}});
 const {service:s}=p.start();
 assert.deepEqual(await s.bootstrap("alice"),LOCKED);
 await assert.rejects(s.skipLock("on",{method:"os"}),/VAULT_LOCKED/);
 await s.unlock("os");assert.equal(mark({service:s},"alice","skip-lock"),false);s.lock();
 p.state.osAllowed=false;
 await assert.rejects(s.unlock("os",undefined,true));assert.equal(mark({service:s},"alice","skip-lock"),false);
 p.state.osAllowed=true;
 const opened=await s.unlock("os",undefined,true);
 assert.equal(opened.phase,"UNLOCKED");assert.equal(opened.skipLockFailed,undefined);
 assert.equal(mark({service:s},"alice","skip-lock"),true);
 await s.skipLock("off");
 p.state.osAllowed=false;
 assert.equal((await s.skipLock("on",{method:"os"})).verified,false);assert.equal(mark({service:s},"alice","skip-lock"),false);
 p.state.osAllowed=true;
 assert.deepEqual(await s.skipLock("on",{method:"os"}),{verified:true,method:"os",skipLockOnStart:true});
});

test("a remembered skip that cannot be saved still unlocks and says so",async t=>{
 const p=pc(t);await accounts(p,{alice:{}});
 const {service:s}=p.start();
 await s.bootstrap("alice");
 const vault=s.active.vault,setMark=vault.setMark.bind(vault);
 vault.setMark=(name,on)=>{if(name==="skip-lock")throw Error("EPERM");return setMark(name,on);};
 const opened=await s.unlock("os",undefined,true);
 assert.equal(opened.phase,"UNLOCKED");assert.equal(opened.skipLockFailed,true);
});

test("app settings hold no skip: settings/set cannot turn it on",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-settings-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const app={getPath:()=>dir};
 assert.equal("skipLockOnStart" in settings.DEFAULTS,false);
 assert.equal("skipLockOnStart" in settings.sanitize({skipLockOnStart:true}),false);
 settings.initSettings(app);
 assert.throws(()=>settings.updateSettings({skipLockOnStart:true}),/INVALID_SETTINGS/);
});

test("IPC: vault/unlock passes the check only as true, vault/skipLock takes an action, logout drops the chance",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../public/electron/configures/ipc.config.js"),"utf8");
 assert.match(source,/"vault\/unlock":\(method,password,remember\)=>s\.vaultWorkspaceService\.unlock\(method,password,remember===true\)/);
 assert.match(source,/"vault\/skipLock":\(action,input\)=>s\.vaultWorkspaceService\.skipLock\(action,input\)/);
 assert.match(source,/"auth\/deleteAuthInfo"[\s\S]{0,200}dropStartOpen/);
 assert.doesNotMatch(source,/openAtStart|takeStartOpen/);
});
