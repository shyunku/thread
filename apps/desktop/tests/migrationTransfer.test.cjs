const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{createHash}=require("node:crypto");
const p=require("../public/electron/e2ee/protocol"),sync=require("../public/electron/e2ee/syncProtocol");
const {MembershipHistory}=require("../public/electron/e2ee/readProtocol"),{EncryptedStore}=require("../public/electron/e2ee/localStore");
const {MigrationJournal}=require("../public/electron/e2ee/migrationJournal"),{MigrationSession}=require("../public/electron/e2ee/migrationSession"),{MigrationTransfer}=require("../public/electron/e2ee/migrationTransfer");
const target="00000000-0000-0000-0000-000000000003",snapshotId="00000000-0000-0000-0000-000000000004";
async function fixture(t,{empty=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-migration-transfer-")),filename=path.join(dir,"vault.db"),key=Buffer.alloc(32,3),ldk=Buffer.alloc(32,4),scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 let store=new EncryptedStore({filename,key:ldk,scope,create:true});
 const device=await p.createDevice(),body={schema:1,vaultId:"vault",recoveryKey:Buffer.alloc(32,8),owner:{id:"owner",role:"write",canAuthorizeDevices:true,signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey}};
 const history=await new MembershipHistory({body,signature:await p.sign(device.signing.privateKey,"genesis",body)},p.fingerprint(body)).initialize();
 const rows=empty?[]:[
  {entityType:"category",entityId:"category",operation:"upsert",version:"1",fields:{title:"SYNTHETIC_PRIVATE_CATEGORY",color:"blue"}},
  {entityType:"task",entityId:"one",operation:"upsert",version:"9007199254740993",fields:{title:"한글",memo:"SYNTHETIC_PRIVATE_MEMO",due_date:0,repeat_period:"month",sort_rank:"999999999999999999999999"}},
  {entityType:"task",entityId:"deleted",operation:"delete",version:"3",fields:{title:"SYNTHETIC_DELETED_TITLE",deleted_at:123}},
  {entityType:"subtask",entityId:"sub",parentId:"one",operation:"upsert",version:"1",fields:{title:"sub",done:false}},
  {entityType:"taskCategory",entityId:"category",parentId:"one",operation:"upsert",version:"2",fields:{present:false}}
 ];
 const sourcePages=empty?[{changes:null}]:[{changes:rows.slice(0,3)},{changes:rows.slice(3)}];
 const source={epoch:"00000000-0000-0000-0000-000000000001",snapshotId:"00000000-0000-0000-0000-000000000002",seq:"9007199254740993",pageCount:sourcePages.length};
 let remote;const accepted=[];
 const signed=async(record,purpose)=>p.verify(device.signing.publicKey,purpose,record.body,record.signature);
 const objects=()=>accepted.flatMap((entry)=>entry.record.body.operations.map((op,index)=>({objectId:op.objectId,version:"1",seq:entry.result.seq,deleted:op.deleted,operationIndex:index,record:p.encode(entry.record).toString("base64")}))).sort((a,b)=>a.objectId<b.objectId?-1:1);
 const snapshot=()=>{
  const all=objects(),hash=createHash("sha256");
  for(const o of all)hash.update(p.encode([o.objectId,o.version,o.seq,o.deleted,o.operationIndex,createHash("sha256").update(Buffer.from(o.record,"base64")).digest()]));
  return {id:snapshotId,epoch:target,seq:String(accepted.length),count:all.length,digest:hash.digest("hex"),membershipHead:history.current.head};
 };
 const transport={
  migrationPrepare:async r=>{await signed(r,"migration");remote={id:r.body.parameters.migrationId,vaultId:"vault",coordinator:"owner",sourceEpoch:source.epoch,sourceSnapshotId:source.snapshotId,freezeSeq:source.seq,targetEpoch:target,pageCount:source.pageCount,objectCount:rows.length,phase:"FROZEN"};return {...remote};},
  migrationSource:async r=>{await signed(r,"migration");const payload=JSON.stringify(sourcePages[r.body.parameters.page]);return {payload,checksum:createHash("sha256").update(payload).digest("hex")};},
  migrationStatus:async r=>{await signed(r,"migration");return {...remote};},
  migrationCancel:async r=>{await signed(r,"migration");assert.ok(["FROZEN","UPLOADING","VERIFIED","CANCELLED"].includes(remote.phase));accepted.length=0;remote.phase="CANCELLED";return {...remote};},
  migrationPush:async r=>{
   await sync.verifyBatch(r,{state:history.current,epoch:target});
   const old=accepted.find(v=>v.record.body.mutationId===r.body.mutationId);if(old){assert.deepEqual(p.encode(old.record),p.encode(r));return old.result;}
   assert.ok(["FROZEN","UPLOADING"].includes(remote.phase));
   const result={seq:String(accepted.length+1),versions:Object.fromEntries(r.body.operations.map(op=>[op.objectId,"1"]))};
   accepted.push({record:r,result});remote.phase="UPLOADING";return result;
  },
  migrationSnapshot:async r=>{await signed(r,"request");return snapshot();},
  migrationSnapshotPage:async r=>{await signed(r,"request");const all=objects().filter(o=>o.objectId>r.body.parameters.after);return {objects:all,next:all.at(-1)?.objectId||r.body.parameters.after,more:false};},
  migrationVerify:async r=>{await signed(r,"migration");assert.equal(r.body.parameters.ciphertextManifest,snapshot().digest);assert.equal(r.body.parameters.sourceObjectCount,rows.length);remote.phase="VERIFIED";remote.ciphertextManifest=snapshot().digest;return {...remote};},
  migrationCommit:async r=>{await signed(r,"migration");assert.equal(remote.phase,"VERIFIED");assert.equal(r.body.parameters.ciphertextManifest,remote.ciphertextManifest);remote.phase="ACTIVE";return {...remote};}
 };
 let session,transfer;
 const attach=()=>{session=new MigrationSession({store,journal:new MigrationJournal(store,{vaultId:"vault"}),history,device,deviceId:"owner",epoch:"1",transport});transfer=new MigrationTransfer({session,keyForGeneration:async()=>key});};
 attach();await session.prepare(source);
 t.after(()=>{session.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},get session(){return session;},get transfer(){return transfer;},get remote(){return remote;},accepted,transport,rows,key,history,device,dir,
  reopen(){session.close();store.close();store=new EncryptedStore({filename,key:ldk,scope});attach();}
 };
}
test("application migration requires consent and authentication, preserves journal on failure and resumes transfer",async t=>{
 const f=await fixture(t),{execute,status}=require("../public/electron/e2ee/applicationMigration");
 f.store.put("recovery","$owner-identity",{phase:"RECOVERY_CONFIRMED",device:f.device,deviceId:"owner",fingerprint:f.history.current.head,keyring:{keys:[{generation:1,key:f.key}]}});
 f.transport.accountStatus=async()=>({vaultId:"vault",epoch:target,revision:0,head:f.history.current.head,keyGeneration:1});
 f.transport.membership=async()=>({genesis:p.encode(f.history.genesis).toString("base64"),head:{vaultId:"vault",revision:0,digest:f.history.current.head},records:[],more:false,next:0});
 const entry={uid:"fixture",migrationIntent:true,abort:new AbortController(),controller:{use:fn=>fn(f.store)}};
 let authenticated=false;
 const service={active:entry,generation:0,busy:false,context:()=>entry,transportFor:()=>f.transport,
  runtime:()=>({osAuth:{verify:async()=>authenticated},getWindow:()=>null}),
  group:{syncV2Service:{sessions:new Map(),opening:new Map(),file:()=>path.join(f.dir,"absent")}}};
 await assert.rejects(execute(service,"transfer",{}),/CONSENT/);
 await assert.rejects(execute(service,"transfer",{confirmed:true,method:"os"}),/AUTH_CANCELLED/);
 assert.equal(status(service).phase,"FROZEN");assert.equal(f.accepted.length,0);
 authenticated=true;service.group.syncV2Service.sessions.set("fixture",{});
 await assert.rejects(execute(service,"transfer",{confirmed:true,method:"os"}),/RESTART_REQUIRED/);
 service.group.syncV2Service.sessions.clear();
 const push=f.transport.migrationPush;let first=true;
 f.transport.migrationPush=async record=>{const result=await push(record);if(first){first=false;throw Error("SYNC_UNAVAILABLE");}return result;};
 await assert.rejects(execute(service,"transfer",{confirmed:true,method:"os"}),/SYNC_UNAVAILABLE/);
 assert.equal(service.busy,false);assert.equal(entry.migrationActive,true);
 assert.equal(entry.migrationIntent,true);
 assert.equal(status(service).phase,"UPLOADING");
 assert.equal((await execute(service,"transfer",{confirmed:true,method:"os"})).phase,"ACTIVE");
 assert.equal(entry.migrationIntent,false);
 assert.equal(f.accepted.length,2);assert.ok(f.store.get("recovery","$owner-identity").device.signing.privateKey.some(v=>v!==0));
 entry.unlocked=true;entry.vault={inspect:()=>({phase:"UNLOCKED"})};
 service.group.userService={setCurrent:()=>{}};
 service.runtime=()=>({getAccount:()=>"fixture"});
 f.transport.accountStatus=async()=>({accountMode:"e2ee",vaultMode:"active"});
 service.syncEncrypted=async()=>({phase:"ACTIVE"});
 assert.deepEqual(await require("../public/electron/e2ee/applicationBootstrap").bootstrap(service,"fixture"),{mode:"E2EE"});
});
test("application cutover pins migrated objects and preserves the device counter",async t=>{
 const f=await fixture(t);await f.transfer.run();
 const {EncryptedReplica}=require("../public/electron/e2ee/replica"),{EncryptedSynchronizer}=require("../public/electron/e2ee/synchronize");
 const replica=new EncryptedReplica(f.store,{vaultId:"vault",epoch:target,deviceId:"owner"},{initialize:false});
 f.transport.membership=async()=>({genesis:p.encode(f.history.genesis).toString("base64"),head:{vaultId:"vault",revision:0,digest:f.history.current.head},records:[],more:false,next:0});
 f.transport.snapshot=f.transport.migrationSnapshot;f.transport.snapshotPage=f.transport.migrationSnapshotPage;
 const engine=new EncryptedSynchronizer({replica,history:f.history,device:f.device,deviceId:"owner",epoch:target,keyForGeneration:async()=>f.key,transport:f.transport});
 t.after(()=>engine.close());
 await engine.snapshot(f.session.journal);
 assert.equal(f.store.get("recovery","$migration-local-"+f.session.journal.get().id).phase,"READY");
 const old=BigInt(f.store.get("recovery","$migration-counter-owner"));
 const id=replica.enqueue([{objectId:"new-task",baseVersion:"0",deleted:false,fields:[{slot:0,value:{title:"new"}}]}]);
 assert.ok(BigInt(f.store.get("outbox",id).counter)>old);
});
test("all canonical fields, identities, tombstones and relationships survive encrypted migration before activation",async t=>{
 const f=await fixture(t),running=f.transfer.run();assert.equal(f.transfer.run(),running);
 assert.equal((await running).phase,"ACTIVE");assert.equal(f.remote.phase,"ACTIVE");
 const values=[];for(const entry of f.accepted)values.push(...await sync.decryptBatch(entry.record,{state:f.history.current,epoch:target,key:f.key}));
 assert.deepEqual(values.map(o=>o.fields[0].value),f.rows);
 assert.equal(values[2].deleted,true);assert.equal(values[2].fields[0].value.fields.title,"SYNTHETIC_DELETED_TITLE");
 assert.equal(f.store.entries("confirmed").length,0);assert.ok(f.store.entries("recovery").length>0);
 for(const name of fs.readdirSync(f.dir))assert.equal(fs.readFileSync(path.join(f.dir,name)).includes(Buffer.from("SYNTHETIC_PRIVATE_MEMO")),false);
});
test("upload ACK loss reopens with exact bytes and does not duplicate mutations",async t=>{
 const f=await fixture(t),push=f.transport.migrationPush;let first=true;
 f.transport.migrationPush=async r=>{const result=await push(r);if(first){first=false;throw Error("SYNC_UNAVAILABLE");}return result;};
 await assert.rejects(f.transfer.run(),/SYNC_UNAVAILABLE/);assert.equal(f.session.journal.get().phase,"UPLOADING");
 const original=p.encode(f.accepted[0].record);f.reopen();
 assert.equal((await f.transfer.run()).phase,"ACTIVE");assert.deepEqual(p.encode(f.accepted[0].record),original);assert.equal(f.accepted.length,2);
});
test("commit ACK loss resumes via status without committing twice or clearing originals",async t=>{
 const f=await fixture(t),commit=f.transport.migrationCommit;let calls=0;
 f.transport.migrationCommit=async r=>{calls++;await commit(r);throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(f.transfer.run(),/SYNC_UNAVAILABLE/);assert.equal(f.session.journal.get().phase,"COMMITTING");
 f.reopen();assert.equal((await f.transfer.run()).phase,"ACTIVE");assert.equal(calls,1);assert.ok(f.store.entries("recovery").length>0);
});
test("missing or substituted snapshot content never reaches verification or commit",async t=>{
 const f=await fixture(t),page=f.transport.migrationSnapshotPage;let verify=0;
 f.transport.migrationVerify=async()=>{verify++;throw Error("must not verify");};
 f.transport.migrationSnapshotPage=async r=>{const response=await page(r);response.objects[0].deleted=!response.objects[0].deleted;return response;};
 await assert.rejects(f.transfer.run());assert.equal(verify,0);assert.equal(f.session.journal.get().phase,"UPLOADING");assert.notEqual(f.remote.phase,"ACTIVE");
});
test("empty accounts can attest an empty manifest and activate without uploading",async t=>{
 const f=await fixture(t,{empty:true});assert.equal((await f.transfer.run()).phase,"ACTIVE");assert.equal(f.accepted.length,0);
});
test("preflight rejects oversized source before upload and can use the existing pre-upload cancel path",async t=>{
 const f=await fixture(t);f.rows[4].fields.note="x".repeat(710*1024);
 await assert.rejects(f.transfer.run(),/MIGRATION_OBJECT_TOO_LARGE/);
 assert.equal(f.accepted.length,0);assert.equal(f.remote.phase,"FROZEN");
 assert.equal((await f.session.cancel()).phase,"CANCELLED");
});
test("uploaded data can be cancelled while originals remain recoverable; a lost cancel ACK retries safely",async t=>{
 const f=await fixture(t),push=f.transport.migrationPush,cancel=f.transport.migrationCancel;
 f.transport.migrationPush=async r=>{await push(r);throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(f.transfer.run(),/SYNC_UNAVAILABLE/);
 assert.equal(f.remote.phase,"UPLOADING");assert.equal(f.accepted.length,1);
 const before=f.store.entries("recovery").length;
 f.transport.migrationCancel=async r=>{await cancel(r);throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(f.session.cancel(),/SYNC_UNAVAILABLE/);
 assert.equal(f.session.journal.get().phase,"UPLOADING");
 f.reopen();f.transport.migrationCancel=cancel;
 assert.equal((await f.session.cancel()).phase,"CANCELLED");
 assert.equal(f.accepted.length,0);assert.equal(f.store.entries("recovery").length,before);
});
test("commit-unknown cancellation checks server state and never rolls back an active account",async t=>{
 const f=await fixture(t),commit=f.transport.migrationCommit;
 f.transport.migrationCommit=async r=>{await commit(r);throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(f.transfer.run(),/SYNC_UNAVAILABLE/);
 assert.equal(f.session.journal.get().phase,"COMMITTING");
 const count=f.accepted.length;
 await assert.rejects(f.session.cancel(),/MIGRATION_ALREADY_ACTIVE/);
 assert.equal(f.remote.phase,"ACTIVE");assert.equal(f.accepted.length,count);
});
test("a not-yet-committed verified attempt can be cancelled",async t=>{
 const f=await fixture(t);
 f.transport.migrationCommit=async()=>{throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(f.transfer.run(),/SYNC_UNAVAILABLE/);
 assert.equal(f.remote.phase,"VERIFIED");
 assert.equal((await f.session.cancel()).phase,"CANCELLED");assert.equal(f.accepted.length,0);
});
