// The lock-screen skip at start (#111): when the first bootstrap of a run may open the vault
// without a prompt, and when it must stay locked.
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{EventEmitter}=require("node:events");
const {VaultWorkspaceService}=require("../public/electron/e2ee/workspaceService");
const {createVaultController}=require("../public/electron/e2ee/vaultController");
const {vaultIpcReply}=require("../public/electron/e2ee/vaultIpcReply");
const {REQUEST_TOPICS}=require("../public/electron/modules/preload");
const settings=require("../public/electron/modules/appSettings");

// One PC: a vault folder and the setting survive "restarts" (new services on the same folder).
function pc(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-lockskip-"));
 const state={skip:false,prompts:0,osAllowed:true,unprotect:null};
 const services=[];
 t.after(()=>{for(const s of services)s.reset();fs.rmSync(dir,{recursive:true,force:true});});
 const start=()=>{
  const window=new EventEmitter(),power=new EventEmitter(),events=[];
  window.webContents=new EventEmitter();power.getSystemIdleTime=()=>0;
  const deps={enabled:true,baseDirectory:dir,environment:"development",getAccount:()=>"fixture",getWindow:()=>window,powerMonitor:power,
   protector:{protect:key=>Buffer.from(key),unprotect:bytes=>{if(state.unprotect)throw state.unprotect;return Buffer.from(bytes);}},
   osAuth:{availability:async()=>true,verify:async()=>{state.prompts++;return state.osAllowed;}},notify:data=>events.push(data),
   transport:{accountStatus:async()=>({accountMode:"e2ee_pending",vaultMode:"uninitialized"})},
   skipLock:{get:()=>state.skip,set:value=>{state.skip=value===true;}}};
  const service=new VaultWorkspaceService(deps);services.push(service);
  return {service,deps,power,events};
 };
 return {dir,state,start};
}
const OPEN={mode:"NEW_ACCOUNT_SETUP"},LOCKED={mode:"LOCKED"};
async function withVault(t,create=s=>s.create({method:"os"})){
 const p=pc(t),first=p.start();await create(first.service);first.service.reset();p.state.prompts=0;return p;
}

test("setting off: the first start shows the lock screen as before",async t=>{
 const p=await withVault(t),{service:s}=p.start();
 assert.deepEqual(await s.bootstrap("fixture"),LOCKED);
 assert.equal(s.active.unlocked,false);assert.equal(p.state.prompts,0);
});

test("setting on: the first bootstrap opens without a prompt and says so; later ones change nothing",async t=>{
 const p=await withVault(t);p.state.skip=true;
 const {service:s,events}=p.start();
 assert.deepEqual(await s.bootstrap("fixture"),OPEN);
 assert.equal(s.active.unlocked,true);assert.equal(p.state.prompts,0);
 assert.equal(events.at(-1).phase,"UNLOCKED");
 assert.deepEqual(await s.bootstrap("fixture"),OPEN);
});

test("a lock in the same run is never undone: screen lock, suspend, 지금 잠그기",async t=>{
 const p=await withVault(t);p.state.skip=true;
 for(const lock of [r=>r.power.emit("lock-screen"),r=>r.power.emit("suspend"),r=>r.service.lock()]){
  const run=p.start(),s=run.service;p.state.prompts=0;
  assert.deepEqual(await s.bootstrap("fixture"),OPEN);
  lock(run);
  assert.equal(s.active.unlocked,false);
  // The LOCKED notice makes the gate bootstrap again: it stays locked.
  assert.equal(run.events.at(-1).phase,"LOCKED");
  assert.deepEqual(await s.bootstrap("fixture"),LOCKED);
  assert.equal(p.state.prompts,0);
  assert.equal((await s.unlock("os")).phase,"UNLOCKED");s.reset();
 }
});

test("a lock before the first bootstrap, or a first bootstrap with the setting off, uses the one chance",async t=>{
 const p=await withVault(t);
 let run=p.start();run.service.context();p.state.skip=true;run.power.emit("lock-screen");
 assert.deepEqual(await run.service.bootstrap("fixture"),LOCKED);run.service.reset();
 p.state.skip=false;run=p.start();
 assert.deepEqual(await run.service.bootstrap("fixture"),LOCKED);
 p.state.skip=true;
 assert.deepEqual(await run.service.bootstrap("fixture"),LOCKED);
 assert.equal(run.service.active.unlocked,false);
});

test("locked by hand stays locked after a restart until the next unlock",async t=>{
 const p=await withVault(t);p.state.skip=true;
 let {service:s}=p.start();
 assert.deepEqual(await s.bootstrap("fixture"),OPEN);
 s.lock();assert.equal(fs.existsSync(path.join(p.dir,"locked-by-user")),true);s.reset();
 ({service:s}=p.start());
 assert.deepEqual(await s.bootstrap("fixture"),LOCKED);
 assert.equal((await s.unlock("os")).phase,"UNLOCKED");
 assert.equal(fs.existsSync(path.join(p.dir,"locked-by-user")),false);s.reset();
 ({service:s}=p.start());
 assert.deepEqual(await s.bootstrap("fixture"),OPEN);
 // A screen lock (not by hand) leaves no mark: the next start opens again.
 const run=p.start();run.service.context();s.reset();
 run.power.emit("lock-screen");
 assert.equal(fs.existsSync(path.join(p.dir,"locked-by-user")),false);
});

test("a mark that cannot be read counts as a lock by hand; one that cannot be written turns the skip off",async t=>{
 const p=await withVault(t);p.state.skip=true;
 fs.mkdirSync(path.join(p.dir,"locked-by-user"));
 let {service:s}=p.start();
 assert.deepEqual(await s.bootstrap("fixture"),LOCKED);s.reset();
 fs.rmSync(path.join(p.dir,"locked-by-user"),{recursive:true});
 ({service:s}=p.start());
 assert.deepEqual(await s.bootstrap("fixture"),OPEN);
 s.holdLock=()=>{throw Error("EPERM");};s.lock();
 assert.equal(p.state.skip,false);assert.equal(s.active.unlocked,false);
});

test("a failed open answers LOCKED and keeps the vault closed",async t=>{
 const p=await withVault(t);p.state.skip=true;p.state.unprotect=Error("DPAPI_FAILED");
 const {service:s}=p.start();
 assert.deepEqual(await s.bootstrap("fixture"),LOCKED);
 assert.equal(s.active.unlocked,false);assert.throws(()=>s.active.controller.use(()=>{}),/LOCKED/);
 p.state.unprotect=null;
 assert.deepEqual(await s.bootstrap("fixture"),LOCKED);
});

test("the renderer cannot ask for the start open",async t=>{
 const p=await withVault(t);p.state.skip=true;
 const {service:s}=p.start();s.userService={getCurrent:()=>"fixture"};
 s.context();
 for(const method of ["start","START",{method:"start"},undefined]){
  const reply=await vaultIpcReply(s,"vault/unlock",(m,pw,remember)=>s.unlock(m,pw,remember),[method]);
  assert.equal(reply.success,false);
 }
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
 const p=await withVault(t);
 const {service:s}=p.start();
 assert.deepEqual(await s.bootstrap("fixture"),LOCKED);
 await assert.rejects(s.enableSkipLock({method:"os"}),/VAULT_LOCKED/);
 // An unlock without the check leaves it off; with it, on.
 await s.unlock("os");assert.equal(p.state.skip,false);s.lock();
 p.state.osAllowed=false;
 await assert.rejects(s.unlock("os",undefined,true));assert.equal(p.state.skip,false);
 p.state.osAllowed=true;
 await s.unlock("os",undefined,true);assert.equal(p.state.skip,true);
 p.state.skip=false;
 p.state.osAllowed=false;
 assert.equal((await s.enableSkipLock({method:"os"})).verified,false);assert.equal(p.state.skip,false);
 p.state.osAllowed=true;
 assert.deepEqual(await s.enableSkipLock({method:"os"}),{verified:true,method:"os",skipLockOnStart:true});
 assert.equal(p.state.skip,true);
});

test("a password vault opens at start too when the skip is on (it has the OS-protected key)",async t=>{
 const p=await withVault(t,s=>s.create("synthetic test password"));p.state.skip=true;
 const {service:s}=p.start();
 assert.deepEqual(await s.bootstrap("fixture"),OPEN);assert.equal(p.state.prompts,0);
 assert.equal((await s.enableSkipLock({method:"password",password:"wrong"})).verified,false);
 assert.equal((await s.enableSkipLock({method:"password",password:"synthetic test password"})).verified,true);
});

test("app settings: skipLockOnStart is a boolean, off by default",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-settings-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const app={getPath:()=>dir};
 assert.equal(settings.DEFAULTS.skipLockOnStart,false);
 assert.equal(settings.loadSettings(app).skipLockOnStart,false);
 assert.equal(settings.sanitize({skipLockOnStart:"yes"}).skipLockOnStart,false);
 assert.equal(settings.sanitize({skipLockOnStart:true}).skipLockOnStart,true);
 assert.throws(()=>settings.validatePatch({skipLockOnStart:1}),/INVALID_SETTINGS/);
 settings.initSettings(app);
 assert.equal(settings.updateSettings({skipLockOnStart:true}).skipLockOnStart,true);
 assert.equal(settings.loadSettings(app).skipLockOnStart,true);
 assert.equal(settings.updateSettings({skipLockOnStart:false}).skipLockOnStart,false);
});

test("settings/set never turns the skip on; vault/unlock passes the check only as true",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../public/electron/configures/ipc.config.js"),"utf8");
 assert.match(source,/"settings\/set"[\s\S]*?patch\?\.skipLockOnStart === true\) return s\.sender\("settings\/set", reqId, false/);
 assert.match(source,/"vault\/unlock":\(method,password,remember\)=>s\.vaultWorkspaceService\.unlock\(method,password,remember===true\)/);
 assert.match(source,/"vault\/skipLock":input=>s\.vaultWorkspaceService\.enableSkipLock\(input\)/);
 assert.doesNotMatch(source,/openAtStart|takeStartOpen/);
});
