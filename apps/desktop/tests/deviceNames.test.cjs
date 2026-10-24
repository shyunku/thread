const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),Module=require("node:module");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const {ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
const {restoreCopies}=require("../public/electron/e2ee/backupCopies");
const {connectedDevices}=require("../public/electron/e2ee/rotationWorkspace");
require("../public/electron/e2ee/platform");
const names=require("@thread/e2ee/src/model/deviceNames");

// Synthetic local vault; no network, no user data.
function adapter(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-device-names-"));
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,4),scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const replica=new EncryptedReplica(store,{vaultId:"vault",epoch:"1",deviceId:"owner"});
 let now=1_000;
 return {app:new ApplicationAdapter(replica,{now:()=>now++}),replica,store};
}
// Turns writing on for one test (2.5.0 behaviour); 2.4.0 ships with it off.
const writeOn=t=>{names.flags.DEVICE_NAMES_WRITE=true;t.after(()=>{names.flags.DEVICE_NAMES_WRITE=false;});};
const nameRows=store=>{
 const rows=[];let after="";
 for(;;){
  const page=store.entries("visible",after,128);
  for(const {value} of page){const row=value.fields?.[0]?.value;if(row?.entityType==="deviceName")rows.push({objectId:value.objectId,row});}
  if(page.length<128)return rows;after=page.at(-1).id;
 }
};

test("2.4.0: the switch is off, so no name row is written and the topics are refused",t=>{
 const {app,store}=adapter(t);
 assert.equal(names.flags.DEVICE_NAMES_WRITE,false);
 app.mutate("task/addTask",[{tid:"t1",title:"할 일"}]);
 assert.throws(()=>app.mutate("device/setDeviceName",["owner","회사 노트북"]),/DEVICE_NAMES_DISABLED/);
 assert.throws(()=>app.mutate("device/setDeviceModel",["owner","Windows PC"]),/DEVICE_NAMES_DISABLED/);
 assert.equal(names.ownNameMutation([],{deviceId:"owner",role:"write",model:"Windows PC"}),null);
 assert.deepEqual(nameRows(store),[]);
 assert.deepEqual(app.lists().deviceNames,[]);
 assert.equal(app.lists().tasks.length,1);
 // The device list still shows this PC by its model, locally.
 const history={current:{devices:new Map([["owner",{id:"owner",role:"write"}]])},records:new Map()};
 assert.deepEqual(connectedDevices(history,"owner",app.lists().deviceNames,{ownModel:"Windows PC"}).map(d=>[d.name,d.canRename]),[["Windows PC",false]]);
});

test("switch on: a name row is created once, then only patched; empty goes back to the model",t=>{
 writeOn(t);
 const {app,store}=adapter(t);
 app.mutate(...names.ownNameMutation([],{deviceId:"owner",role:"write",model:"Windows PC"}));
 assert.deepEqual(app.lists().deviceNames,[{deviceId:"owner",name:"Windows PC",model:"Windows PC"}]);
 // Already there: nothing more to write for itself.
 assert.equal(names.ownNameMutation(app.lists().deviceNames,{deviceId:"owner",role:"write",model:"Windows PC"}),null);
 // Read-only devices never write.
 assert.equal(names.ownNameMutation([],{deviceId:"viewer",role:"read",model:"Galaxy S24"}),null);
 const [first]=nameRows(store);
 app.mutate("device/setDeviceName",["owner","  회사 노트북 "]);
 const [second]=nameRows(store);
 assert.equal(second.objectId,first.objectId);
 assert.equal(second.row.fields.name,"회사 노트북");
 assert.equal(second.row.fields.model,"Windows PC");
 app.mutate("device/setDeviceName",["owner",""]);
 assert.equal(app.lists().deviceNames[0].name,"Windows PC");
 assert.equal(nameRows(store).length,1);
 // Another device's name can be set before that device wrote its own row; its own model
 // then joins without replacing the name.
 app.mutate("device/setDeviceName",["phone-1","내 폰"]);
 assert.throws(()=>app.mutate("device/setDeviceName",["phone-1",""]),/DEVICE_NAME_INVALID/);
 app.mutate(...names.ownNameMutation(app.lists().deviceNames,{deviceId:"phone-1",role:"write",model:"Galaxy S24"}));
 assert.deepEqual(app.lists().deviceNames.find(e=>e.deviceId==="phone-1"),{deviceId:"phone-1",name:"내 폰",model:"Galaxy S24"});
 assert.equal(nameRows(store).length,2);
});

test("switch on: invalid names and device ids are refused",t=>{
 writeOn(t);
 const {app,store}=adapter(t);
 for(const bad of ["a".repeat(41),"줄\n바꿈","탭\t중간","‮뒤집기","   ",42,null])
  assert.throws(()=>app.mutate("device/setDeviceName",["owner",bad]),/DEVICE_NAME_INVALID/,String(bad));
 for(const id of ["",".."," x","a".repeat(129),7])assert.throws(()=>app.mutate("device/setDeviceName",[id,"이름"]),/INVALID_DEVICE_ID/);
 assert.deepEqual(nameRows(store),[]);
 app.mutate("device/setDeviceName",["owner","가".repeat(40)]);
 assert.equal(app.lists().deviceNames[0].name,"가".repeat(40));
});

test("name rows from other devices: a malformed one is skipped and two creates for one device do not stop the lists",t=>{
 const {app,replica}=adapter(t);
 const put=(objectId,row)=>replica.enqueue([{objectId,baseVersion:"0",deleted:false,fields:[{slot:0,value:row}]}]);
 app.mutate("task/addTask",[{tid:"t1",title:"할 일"}]);
 put("a".repeat(32),{entityType:"deviceName",entityId:"pc-2",operation:"upsert",fields:{name:"먼저",updated_at:5}});
 put("b".repeat(32),{entityType:"deviceName",entityId:"pc-2",operation:"upsert",fields:{name:"나중",updated_at:9}});
 put("c".repeat(32),{entityType:"deviceName",entityId:"pc-3",operation:"upsert",fields:{name:{text:"future"}}});
 const lists=app.lists();
 assert.deepEqual(lists.deviceNames,[{deviceId:"pc-2",name:"나중",model:null}]);
 assert.equal(lists.tasks.length,1);
 // Edits keep working next to them.
 app.mutate("task/updateTaskTitle",["t1","바뀜"]);
 assert.equal(app.lists().tasks[0].title,"바뀜");
 // Other types still fail on a duplicate.
 put("d".repeat(32),{entityType:"task",entityId:"t1",operation:"upsert",fields:{title:"x",sort_rank:"1"}});
 assert.throws(()=>app.lists(),/CANONICAL_ID_COLLISION/);
});

test("a backup restore copies tasks and leaves device names out",t=>{
 writeOn(t);
 const source=adapter(t),target=adapter(t);
 source.app.mutate("category/createCategory",[{cid:"c1",title:"업무"}]);
 source.app.mutate("task/addTask",[{tid:"t1",title:"할 일",categories:["c1"]}]);
 source.app.mutate("device/setDeviceName",["owner","회사 노트북"]);
 const records=[];let after="";
 for(;;){
  const page=source.store.entries("visible",after,128);
  for(const {id,value} of page)if(!id.startsWith("$"))records.push({id:"backup-record-"+id,value:{bucket:"visible",id,value}});
  if(page.length<128)break;after=page.at(-1).id;
 }
 assert.equal(records.filter(r=>r.value.value.fields[0].value.entityType==="deviceName").length,1);
 const backup={entries:(bucket,from)=>bucket==="recovery"?records.filter(r=>r.id>from).sort((a,b)=>a.id<b.id?-1:1):[]};
 const result=restoreCopies(target.replica,backup,"backup-1");
 assert.equal(result.count,2);
 const lists=target.app.lists();
 assert.deepEqual(lists.tasks.map(r=>r.title),["할 일"]);
 assert.deepEqual(lists.deviceNames,[]);
});

test("the renderer may call setDeviceName; legacy and plaintext v2 refuse it",async()=>{
 const contract=require("../public/electron/modules/preload");
 assert.ok(contract.REQUEST_TOPICS.includes("device/setDeviceName"));
 // The own model is written by main only.
 assert.equal(contract.REQUEST_TOPICS.includes("device/setDeviceModel"),false);
 const original=Module._load;
 Module._load=function(request,parent,...rest){
  if(parent?.filename.endsWith("sync-v2"+path.sep+"service.js")){
   if(request==="../modules/filesystem")return {getUserDataPath:()=>os.tmpdir()};
   if(request==="../modules/util")return {getServerFinalEndpoint:()=>"http://fixture/v1"};
  }
  return original.call(this,request,parent,...rest);
 };
 let SyncV2Service;
 try{({SyncV2Service}=require("../public/electron/sync-v2/service"));}finally{Module._load=original;}
 const events=[],queued=[],service=new SyncV2Service();
 service.inject({userService:{getCurrent:()=>"fixture"},ipcService:{sender:(...event)=>events.push(event)}});
 service.sessions.set("fixture",{uid:"fixture",connected:false,replica:{enqueue:async change=>{queued.push(change);return "x";},view:async()=>({rows:[],pending:[],epoch:null}),meta:async()=>undefined}});
 assert.equal(await service.intercept("device/setDeviceName","rename",["owner","이름"]),true);
 assert.equal(queued.length,0);
 assert.deepEqual(events.at(-1),["device/setDeviceName","rename",false,{syncV2Ack:true,code:"UNSUPPORTED_V2_ACTION"}]);
 const source=fs.readFileSync(path.join(__dirname,"../public/electron/configures/ipc.config.js"),"utf8");
 assert.match(source,/"device\/setDeviceName",[\s\S]*UNSUPPORTED_LEGACY_ACTION/);
});

// A real unlocked E2EE workspace with an in-memory server (as in mutationQueue.test.cjs).
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function workspace(t){
 const {EventEmitter}=require("node:events"),{VaultWorkspaceService}=require("../public/electron/e2ee/workspaceService");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-device-names-ws-")),window=new EventEmitter(),power=new EventEmitter(),events=[];
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
 const runs=[],sync=s.syncEncrypted.bind(s);
 s.syncEncrypted=()=>{const run=sync();runs.push(run);return run;};
 const settle=async()=>{for(let seen=-1;seen!==runs.length;){seen=runs.length;await Promise.allSettled(runs);await wait(60);}};
 assert.deepEqual(await s.bootstrap("fixture"),{mode:"E2EE"});
 await settle();
 const reply=reqId=>events.find(event=>event[1]===reqId&&event[0]!=="sync-v2/state");
 const store=()=>s.context().controller.use(value=>value);
 return {s,accepted,settle,reply,store,ownId:saved.deviceId};
}

test("2.4.0 PC: renaming is refused, nothing is pushed, and the device list shows this PC by its model",{timeout:30000},async t=>{
 const w=await workspace(t),{s}=w,pushed=w.accepted.length;
 assert.equal(await s.interceptApplication("device/setDeviceName","rename",[w.ownId,"회사 노트북"]),true);
 assert.deepEqual(w.reply("rename").slice(2),[false,{syncV2Ack:true,code:"DEVICE_NAMES_DISABLED"}]);
 await w.settle();
 assert.equal(w.accepted.length,pushed);
 assert.deepEqual(nameRows(w.store()),[]);
 const devices=await s.rotation("devices");
 assert.deepEqual(devices.map(d=>[d.own,d.name,d.canRename]),[[true,"Windows PC",false]]);
});

test("switch on: a PC writes its default name once after the first sync, renames patch it, any PC lists devices",{timeout:30000},async t=>{
 writeOn(t);
 const w=await workspace(t),{s}=w;
 const [own]=nameRows(w.store());
 assert.equal(own.row.entityId,w.ownId);
 assert.deepEqual([own.row.fields.name,own.row.fields.model],["Windows PC","Windows PC"]);
 assert.equal(w.store().entries("outbox").length,0,"the default name was pushed");
 assert.equal(await s.interceptApplication("device/setDeviceName","rename",[w.ownId,"회사 노트북"]),true);
 assert.equal(w.reply("rename")[2],true);
 await w.settle();
 const rows=nameRows(w.store());
 assert.equal(rows.length,1);
 assert.equal(rows[0].objectId,own.objectId);
 assert.equal(rows[0].row.fields.name,"회사 노트북");
 assert.deepEqual((await s.rotation("devices")).map(d=>[d.name,d.canRename,d.showId]),[["회사 노트북",true,false]]);
 // Another sync does not write it again.
 const pushed=w.accepted.length;
 await s.syncEncrypted();await w.settle();
 assert.equal(w.accepted.length,pushed);
 // A paired (non-owner) PC sees the list too.
 w.store().transaction(db=>{const identity=db.get("recovery","$owner-identity");db.put("recovery","$paired-device",identity);db.delete("recovery","$owner-identity");});
 assert.deepEqual((await s.rotation("devices")).map(d=>[d.own,d.name]),[[true,"회사 노트북"]]);
});
