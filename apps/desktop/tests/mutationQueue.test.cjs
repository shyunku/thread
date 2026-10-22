// #102: a mutation that arrives while the vault is busy (a running sync, a user check) waits
// for it and applies in arrival order instead of failing with VAULT_BUSY.
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{EventEmitter}=require("node:events");
const {VaultWorkspaceService}=require("../public/electron/e2ee/workspaceService");
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// A real unlocked E2EE workspace with an in-memory server (same as vaultWorkspace.test.cjs).
async function workspace(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-queue-")),window=new EventEmitter(),power=new EventEmitter(),events=[];
 window.webContents=new EventEmitter();power.getSystemIdleTime=()=>0;
 const deps={enabled:true,baseDirectory:dir,environment:"development",getAccount:()=>"fixture",getWindow:()=>window,powerMonitor:power,
  protector:{protect:key=>Buffer.from(key),unprotect:bytes=>Buffer.from(bytes)},osAuth:{availability:async()=>true,verify:async()=>true},notify:()=>{}};
 const s=new VaultWorkspaceService(deps);
 t.after(()=>{s.reset();fs.rmSync(dir,{recursive:true,force:true});});
 const p=require("../public/electron/e2ee/protocol"),owner=require("../public/electron/e2ee/ownerIdentity"),{createHash}=require("node:crypto");
 await s.create("synthetic test password");await s.unlock("os");
 await s.context().controller.use(async store=>{await owner.prepareOwner(store);const kit=owner.recoveryMaterial(store);await owner.confirmOwnerRecovery(store,kit.code,kit.bytes);});
 const saved=s.context().controller.use(store=>store.get("recovery","$owner-identity")),vaultId=s.context().controller.use(store=>store.scope().vaultId),accepted=[];
 deps.transport={
  accountStatus:async()=>({vaultId,accountMode:"e2ee",vaultMode:"active",epoch:"1",revision:0,keyGeneration:1,head:saved.fingerprint}),
  legacyCapabilities:async()=>{throw Error("MUST_NOT_USE_V2");},
  membership:async()=>({genesis:p.encode(saved.genesis).toString("base64"),head:{vaultId,revision:0,digest:saved.fingerprint},records:[],next:0,more:false}),
  snapshot:async()=>({id:"00000000-0000-0000-0000-000000000001",epoch:"1",seq:"0",membershipHead:saved.fingerprint,count:0,digest:createHash("sha256").digest("hex")}),
  snapshotPage:async()=>({objects:[],next:"",more:false}),
  pull:async proof=>{const target=proof.body.parameters.until==="0"?String(accepted.length):proof.body.parameters.until;return {changes:accepted.slice(Number(proof.body.parameters.after),Number(target)),next:target,until:target,more:false};},
  push:async record=>{const result={seq:String(accepted.length+1),versions:Object.fromEntries(record.body.operations.map(op=>[op.objectId,String(BigInt(op.baseVersion)+1n)]))};accepted.push({record:p.encode(record).toString("base64"),result});return result;}
 };
 s.inject({userService:{setCurrent:()=>{}},ipcService:{sender:(...event)=>events.push(event)},syncV2Service:{sessions:new Map(),file:()=>path.join(dir,"missing-v2")}});
 assert.deepEqual(await s.bootstrap("fixture"),{mode:"E2EE"});
 // Every sync the service starts, to wait for them all at the end.
 const runs=[],sync=s.syncEncrypted.bind(s);
 s.syncEncrypted=()=>{const run=sync();runs.push(run);return run;};
 const settle=async()=>{for(let seen=-1;seen!==runs.length;){seen=runs.length;await Promise.allSettled(runs);await wait(60);}};
 await settle();
 const reply=reqId=>events.find(event=>event[1]===reqId);
 const tasks=()=>s.context().controller.use(store=>{
  const {EncryptedReplica}=require("../public/electron/e2ee/replica"),{ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
  return new ApplicationAdapter(new EncryptedReplica(store,store.get("confirmed","$sync-state").scope,{initialize:false})).lists().tasks;
 });
 const pending=()=>s.context().controller.use(store=>store.entries("outbox").length);
 return {s,deps,events,accepted,runs,settle,reply,tasks,pending};
}

test("mutations sent during a running sync wait for it, apply in arrival order and sync once after",{timeout:30000},async t=>{
 const w=await workspace(t),{s,deps,events}=w;
 // Hold the server's answer to the first push, so the sync stays running.
 let release;const hold=new Promise(resolve=>{release=resolve;}),push=deps.transport.push;
 deps.transport.push=async record=>{await hold;return push(record);};
 const runsBefore=w.runs.length;
 assert.equal(await s.interceptApplication("task/addTask","a",[{tid:"a",title:"A"}]),true);
 assert.equal(w.reply("a")[2],true);
 assert.equal(s.busy,true,"the sync started by the first change holds the vault");
 // A burst while it runs: later writes to the same field must win, and B's rename needs B.
 const order=["t1","b","t2","tb","memo"],sent=[
  s.interceptApplication("task/updateTaskTitle","t1",["a","first"]),
  s.interceptApplication("task/addTask","b",[{tid:"b",title:"B"}]),
  s.interceptApplication("task/updateTaskTitle","t2",["a","second"]),
  s.interceptApplication("task/updateTaskTitle","tb",["b","B renamed"]),
  s.interceptApplication("task/updateTaskMemo","memo",["a","memo"]),
 ];
 // A retry during the run answers at once (it does not wait for the queued changes).
 await s.interceptApplication("sync-v2/retry","retry",[]);
 assert.equal(w.reply("retry")[3].code,"VAULT_BUSY");
 await wait(150);
 for(const id of order)assert.equal(w.reply(id),undefined,`${id} waits for the sync`);
 assert.deepEqual(w.tasks().map(task=>task.title),["A"]);
 release();
 assert.deepEqual(await Promise.all(sent),[true,true,true,true,true]);
 // Answered in the order they arrived, all accepted.
 const answers=events.filter(event=>order.includes(event[1])&&event[0]!=="sync-v2/state");
 assert.deepEqual(answers.map(event=>[event[1],event[2]]),order.map(id=>[id,true]));
 const byId=Object.fromEntries(w.tasks().map(task=>[task.tid,task]));
 assert.equal(byId.a.title,"second");assert.equal(byId.a.memo,"memo");assert.equal(byId.b.title,"B renamed");
 await w.settle();
 // The first change's sync plus one sync for the whole queue (the refused retry is the third
 // call); everything reached the server.
 const results=await Promise.allSettled(w.runs.slice(runsBefore));
 assert.deepEqual(results.map(r=>r.status==="fulfilled"?"ok":r.reason.message),["ok","VAULT_BUSY","ok"]);
 assert.equal(w.pending(),0);
 assert.equal(s.busy,false);
});

test("a mutation still answers VAULT_BUSY when the vault stays busy past the wait",{timeout:20000},async t=>{
 const w=await workspace(t),{s}=w;
 s.mutationWait=200;s.busy=true;
 const started=Date.now(),sent=s.interceptApplication("task/addTask","late",[{tid:"late",title:"Late"}]);
 assert.equal(await sent,true);
 assert.ok(Date.now()-started>=180,"it waited");
 assert.equal(w.reply("late")[2],false);
 assert.equal(w.reply("late")[3].code,"VAULT_BUSY");
 assert.equal(w.reply("late")[3].syncV2Ack,true);
 s.busy=false;await wait(80);
 assert.equal(w.tasks().some(task=>task.tid==="late"),false,"a timed-out change is not applied later");
 assert.equal(s.mutationQueue.length,0);
});

test("a user check holding the vault delays mutations instead of dropping them",{timeout:20000},async t=>{
 const w=await workspace(t),{s,deps}=w;
 deps.osAuth.verify=()=>new Promise(resolve=>setTimeout(()=>resolve(true),300));
 const check=s.verifyUser({method:"os"});
 while(!s.busy)await new Promise(resolve=>setImmediate(resolve));
 const sent=s.interceptApplication("task/addTask","during",[{tid:"during",title:"During the check"}]);
 await wait(120);
 assert.equal(w.reply("during"),undefined);
 assert.deepEqual(await check,{verified:true,method:"os"});
 assert.equal(await sent,true);
 assert.equal(w.reply("during")[2],true);
 assert.ok(w.tasks().some(task=>task.tid==="during"));
 await w.settle();
 assert.equal(w.pending(),0);
});

test("a queued mutation fails cleanly when the vault locks while it waits, and starts no sync",{timeout:20000},async t=>{
 const w=await workspace(t),{s}=w;
 s.busy=true;
 const runsBefore=w.runs.length,sent=s.interceptApplication("task/addTask","locked",[{tid:"x",title:"X"}]);
 await wait(60);
 s.lock();s.busy=false;
 assert.equal(await sent,true);
 assert.equal(w.reply("locked")[2],false);
 assert.match(w.reply("locked")[3].code,/VAULT_LOCKED|VAULT_SESSION_CHANGED|SESSION_CLOSED/);
 await wait(80);
 assert.equal(w.runs.length,runsBefore);
});

test("a change arriving after the vault frees up waits behind the queued ones",{timeout:20000},async t=>{
 const w=await workspace(t),{s,events}=w;
 s.busy=true;
 const first=s.interceptApplication("task/addTask","q1",[{tid:"q",title:"one"}]);
 await wait(10);
 // Free, but q1 has not been applied yet: q2 must not overtake it.
 s.busy=false;
 const second=s.interceptApplication("task/updateTaskTitle","q2",["q","two"]);
 assert.deepEqual(await Promise.all([first,second]),[true,true]);
 assert.deepEqual(events.filter(event=>["q1","q2"].includes(event[1])).map(event=>[event[1],event[2]]),[["q1",true],["q2",true]]);
 assert.equal(w.tasks().find(task=>task.tid==="q").title,"two");
 await w.settle();
});
