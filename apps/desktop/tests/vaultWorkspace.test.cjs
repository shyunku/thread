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
 assert.deepEqual(s.outboxReviews(),{items:[],next:"",more:false});
 f.power.emit("lock-screen");assert.throws(()=>s.intakes(),/LOCKED/);
 assert.throws(()=>s.outboxReviews(),/LOCKED/);
 assert.throws(()=>s.outboxDetail({id:"0".repeat(32),objectId:"task"}),/LOCKED/);
 assert.throws(()=>s.resolveConflict({}),/LOCKED/);
 s.busy=true;assert.throws(()=>s.resolveConflict({}),/VAULT_BUSY/);s.busy=false;
 await assert.rejects(s.unlock("password","wrong"),/./);
 assert.equal((await s.unlock("os")).phase,"UNLOCKED");
 const before=fs.readdirSync(f.dir);f.switchAccount("other");
 assert.equal((await s.status()).phase,"ABSENT");assert.deepEqual(fs.readdirSync(f.dir),before);
 assert.throws(()=>s.outboxReviews(),/LOCKED/);
 f.switchAccount("fixture");assert.equal((await s.status()).phase,"LOCKED");
 assert.equal((await s.unlock("password","synthetic test password")).phase,"UNLOCKED");
 f.window.webContents.emit("render-process-gone");
 assert.throws(()=>s.intakes(),/LOCKED/);
});
test("late OS authentication cannot reopen a switched account; explicit disabled gate creates no files",async t=>{
 const f=fixture(t);await f.service.create("synthetic test password");
 let finish;f.deps.osAuth.verify=()=>new Promise(resolve=>{finish=resolve;});
 const pending=f.service.unlock("os");f.switchAccount("other");finish(true);
 await assert.rejects(pending);assert.equal((await f.service.status()).phase,"ABSENT");
 f.deps.enabled=false;assert.deepEqual(await f.service.status(),{enabled:false});
 await assert.rejects(f.service.create("synthetic test password"),/NOT_ENABLED/);
});

test("application bootstrap reopens pinned E2EE offline after restart and never probes legacy",async t=>{
 const f=fixture(t),s=f.service,{pinApplication}=require("../public/electron/e2ee/applicationBootstrap"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
 await s.create("synthetic test password");await s.unlock("os");
 s.context().controller.use(store=>{
  new EncryptedReplica(store,{vaultId:store.scope().vaultId,deviceId:"fixture",epoch:"1"});
  pinApplication(store);
 });
 s.reset();assert.deepEqual(await s.bootstrap("fixture"),{mode:"LOCKED"});
 await s.unlock("password","synthetic test password");
 f.deps.transport={accountStatus:async()=>{throw Error("MUST_NOT_FETCH");},legacyCapabilities:async()=>{throw Error("MUST_NOT_FETCH");}};
 assert.deepEqual(await s.bootstrap("fixture"),{mode:"E2EE"});
 assert.equal(s.active.applicationActive,true);assert.ok(s.active.poller);
 s.lock();assert.equal(s.active.poller,null);assert.deepEqual(await s.bootstrap("fixture"),{mode:"LOCKED"});
});
test("bootstrap preserves pre-release v2 but refuses unknown, retired and changed modes",async t=>{
 const f=fixture(t),s=f.service;
 f.deps.transport={accountStatus:async()=>{throw Error("SYNC_UNAVAILABLE");},legacyCapabilities:async()=>({mode:"v2",protocolVersion:2,enabled:true})};
 assert.deepEqual(await s.bootstrap("fixture"),{mode:"LEGACY"});assert.equal(fs.readdirSync(f.dir).length,0);
 f.deps.transport.legacyCapabilities=async()=>{throw Error("UPDATE_REQUIRED");};
 assert.deepEqual(await s.bootstrap("fixture"),{mode:"MIGRATION_REQUIRED"});
 f.deps.transport.legacyCapabilities=async()=>{throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(s.bootstrap("fixture"),/APPLICATION_MODE_UNAVAILABLE/);
 f.deps.transport.accountStatus=async()=>({accountMode:"e2ee",vaultMode:"active"});
 assert.deepEqual(await s.bootstrap("fixture"),{mode:"SETUP_REQUIRED"});
 f.deps.transport.accountStatus=async()=>({accountMode:"v2"});
 await assert.rejects(s.bootstrap("fixture"),/APPLICATION_MODE_CHANGED/);
});
test("bootstrap cannot pin a late response onto another account",async t=>{
 const f=fixture(t);let finish;
 f.deps.transport={accountStatus:()=>new Promise(resolve=>{finish=resolve;}),legacyCapabilities:async()=>({mode:"v2",protocolVersion:2,enabled:true})};
 const result=f.service.bootstrap("fixture");f.switchAccount("other");finish({accountMode:"e2ee",vaultMode:"active"});
 await assert.rejects(result,/VAULT_SESSION_CHANGED/);
 assert.equal(f.service.active,null);
});

test("real service bootstraps signed E2EE, handles normal CRUD, restarts offline and clears on lock",async t=>{
 const f=fixture(t),s=f.service,p=require("../public/electron/e2ee/protocol"),owner=require("../public/electron/e2ee/ownerIdentity"),{createHash}=require("node:crypto"),events=[];
 await s.create("synthetic test password");await s.unlock("os");
 await s.context().controller.use(async store=>{await owner.prepareOwner(store);const kit=owner.recoveryMaterial(store);await owner.confirmOwnerRecovery(store,kit.code,kit.bytes);});
 const saved=s.context().controller.use(store=>store.get("recovery","$owner-identity")),vaultId=s.context().controller.use(store=>store.scope().vaultId),accepted=[];
 f.deps.transport={
  accountStatus:async()=>({vaultId,accountMode:"e2ee",vaultMode:"active",epoch:"1",revision:0,keyGeneration:1,head:saved.fingerprint}),
  legacyCapabilities:async()=>{throw Error("MUST_NOT_USE_V2");},
  membership:async()=>({genesis:p.encode(saved.genesis).toString("base64"),head:{vaultId,revision:0,digest:saved.fingerprint},records:[],next:0,more:false}),
  snapshot:async()=>({id:"00000000-0000-0000-0000-000000000001",epoch:"1",seq:"0",membershipHead:saved.fingerprint,count:0,digest:createHash("sha256").digest("hex")}),
  snapshotPage:async()=>({objects:[],next:"",more:false}),
  pull:async proof=>{const target=proof.body.parameters.until==="0"?String(accepted.length):proof.body.parameters.until;return {changes:accepted.slice(Number(proof.body.parameters.after),Number(target)),next:target,until:target,more:false};},
  push:async record=>{await p.verify(saved.device.signing.publicKey,"mutation",record.body,record.signature);const result={seq:String(accepted.length+1),versions:Object.fromEntries(record.body.operations.map(op=>[op.objectId,String(BigInt(op.baseVersion)+1n)]))};accepted.push({record:p.encode(record).toString("base64"),result});return result;}
 };
 s.inject({userService:{setCurrent:()=>{}},ipcService:{sender:(...event)=>events.push(event)},syncV2Service:{sessions:new Map(),file:()=>path.join(f.dir,"missing-v2")}});
 assert.deepEqual(await s.bootstrap("fixture"),{mode:"E2EE"});
 assert.equal(await s.interceptApplication("auth/isDatabaseReady","ready",["fixture"]),true);
 assert.ok(events.some(event=>event[0]==="auth/isDatabaseReady"&&event[2]===true&&event[3]===true));
 let lastSync;const sync=s.syncEncrypted.bind(s);s.syncEncrypted=()=>{lastSync=sync();return lastSync;};
 assert.equal(await s.interceptApplication("task/addTask","add",[{tid:"task",title:"Synthetic private task"}]),true);await lastSync;
 assert.equal(accepted.length,1);assert.ok(events.some(event=>event[0]==="sync-v2/state"&&event[3].tasks[0]?.title==="Synthetic private task"));
 s.reset();assert.deepEqual(await s.bootstrap("fixture"),{mode:"LOCKED"});await s.unlock("password","synthetic test password");
 f.deps.transport.accountStatus=async()=>{throw Error("OFFLINE");};
 assert.deepEqual(await s.bootstrap("fixture"),{mode:"E2EE"});
 events.length=0;await s.interceptApplication("task/getAllTaskList","read",[]);
 assert.ok(events.some(event=>event[0]==="task/getAllTaskList"&&event[3][0]?.title==="Synthetic private task"));
 s.lock();assert.ok(events.some(event=>event[0]==="sync-v2/state"&&event[3].tasks.length===0));
 events.length=0;assert.equal(await s.interceptApplication("task/getAllTaskList","locked",[]),true);
 assert.equal(events[0][2],false);assert.equal(events[0][3].code,"VAULT_LOCKED");
});
test("recovery export never replaces a file and confirmation reopens the selected bytes",async t=>{
 const f=fixture(t),s=f.service,filename=path.join(f.dir,"test.thread-recovery");
 await s.create("synthetic test password");await s.unlock("os");
 assert.equal((await s.prepareIdentity()).phase,"RECOVERY_UNCONFIRMED");
 const code=s.recoveryCode();
 f.deps.dialog={showSaveDialog:async()=>({canceled:false,filePath:filename}),showOpenDialog:async()=>({canceled:false,filePaths:[filename]})};
 assert.equal(await s.exportRecovery(),true);const before=fs.readFileSync(filename);
 await assert.rejects(s.exportRecovery(),/EEXIST/);assert.deepEqual(fs.readFileSync(filename),before);
 await assert.rejects(s.confirmRecovery("wrong"));
 assert.equal(s.identityStatus().phase,"RECOVERY_UNCONFIRMED");
 assert.equal((await s.confirmRecovery(code)).phase,"RECOVERY_CONFIRMED");
 s.lock();assert.throws(()=>s.recoveryCode(),/LOCKED/);
});
