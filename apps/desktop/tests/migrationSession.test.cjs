const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{createHash}=require("node:crypto");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{MigrationJournal}=require("../public/electron/e2ee/migrationJournal");
const {MigrationSession,createMigrationRequest}=require("../public/electron/e2ee/migrationSession");
const snapshot={epoch:"00000000-0000-0000-0000-000000000001",snapshotId:"00000000-0000-0000-0000-000000000002",seq:"9007199254740993",pageCount:1};
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-migration-session-")),filename=path.join(dir,"vault.db"),key=Buffer.alloc(32,8);
 const scope={environment:"development",accountId:"fixture-user",vaultId:"fixture"};
 let store=new EncryptedStore({filename,key,scope,create:true});
 const device=await p.createDevice(),body={schema:1,vaultId:"fixture",recoveryKey:Buffer.alloc(32,7),owner:{id:"owner",role:"write",canAuthorizeDevices:true,signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey}};
 const state=await m.verifyGenesis({body,signature:await p.sign(device.signing.privateKey,"genesis",body)},p.fingerprint(body));
 const text="SYNTHETIC_MIGRATION_SOURCE_PRIVATE",payload=JSON.stringify({changes:[{title:text.repeat(40000)}]}),checksum=createHash("sha256").update(payload).digest("hex");
 let status,sourceCalls=0;
 const verify=async record=>p.verify(device.signing.publicKey,"migration",record.body,record.signature);
 const transport={
  migrationPrepare:async record=>{
   await verify(record);const params=record.body.parameters;
   status ||= {id:params.migrationId,vaultId:"fixture",coordinator:"owner",sourceEpoch:params.sourceEpoch,sourceSnapshotId:params.sourceSnapshotId,freezeSeq:params.freezeSeq,targetEpoch:"00000000-0000-0000-0000-000000000003",phase:"FROZEN",pageCount:1,objectCount:1};return {...status};
  },
  migrationStatus:async record=>{await verify(record);return {...status};},
  migrationSource:async record=>{await verify(record);sourceCalls++;return {payload,checksum};},
  migrationCancel:async record=>{await verify(record);status.phase="CANCELLED";return {...status};}
 };
 const make=()=>new MigrationSession({store,journal:new MigrationJournal(store,{vaultId:"fixture"}),history:{current:state},device,deviceId:"owner",epoch:"1",transport});
 let session=make();t.after(()=>{session.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},get session(){return session;},transport,payload,checksum,dir,state,device,
  get sourceCalls(){return sourceCalls;},
  reopen(){session.close();store.close();store=new EncryptedStore({filename,key,scope});session=make();return session;}
 };
}
test("prepare ACK loss resumes the same migration; large source pages persist encrypted across restart",async t=>{
 const f=await fixture(t),prepare=f.transport.migrationPrepare;
 f.transport.migrationPrepare=async record=>{await prepare(record);throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(f.session.prepare(snapshot),/SYNC_UNAVAILABLE/);
 const id=f.session.journal.get().id;
 f.reopen();f.transport.migrationPrepare=prepare;
 const frozen=await f.session.prepare(snapshot);assert.equal(frozen.id,id);
 assert.equal(f.session.journal.get().phase,"FROZEN");
 assert.deepEqual(await f.session.sourcePage(0),{payload:f.payload,checksum:f.checksum});
 f.reopen();assert.deepEqual(await f.session.sourcePage(0),{payload:f.payload,checksum:f.checksum});assert.equal(f.sourceCalls,1);
 for(const name of fs.readdirSync(f.dir))assert.equal(fs.readFileSync(path.join(f.dir,name)).includes(Buffer.from("SYNTHETIC_MIGRATION_SOURCE_PRIVATE")),false);
});
test("source substitution and changed source checkpoint cannot replace preserved plan/cache",async t=>{
 const f=await fixture(t);await f.session.prepare(snapshot);
 await assert.rejects(f.session.prepare({...snapshot,seq:"2"}),/SOURCE_CHANGED/);
 f.transport.migrationSource=async()=>({payload:"changed",checksum:f.checksum});
 await assert.rejects(f.session.sourcePage(0),/SOURCE_CORRUPT/);
 assert.equal(f.store.entries("recovery").some(row=>row.id.startsWith("$migration-source-")),false);
});
test("cancel requires a matching status requery and preserves local recovery/source",async t=>{
 const f=await fixture(t);await f.session.prepare(snapshot);await f.session.sourcePage(0);
 const status=f.transport.migrationStatus;
 f.transport.migrationStatus=async record=>({...await status(record),phase:"FROZEN"});
 await assert.rejects(f.session.cancel(),/INVALID_MIGRATION_RESPONSE/);
 assert.equal(f.session.journal.get().phase,"FROZEN");
 f.transport.migrationStatus=status;
 assert.equal((await f.session.cancel()).phase,"CANCELLED");
 assert.ok(f.store.entries("recovery").some(row=>row.id.startsWith("$migration-source-")));
 assert.equal(f.store.entries("confirmed").length,0);
});
test("closing during prepare blocks late local state changes; read-only members cannot coordinate",async t=>{
 const f=await fixture(t),prepare=f.transport.migrationPrepare;
 f.transport.migrationPrepare=async record=>{const result=await prepare(record);f.session.close();return result;};
 await assert.rejects(f.session.prepare(snapshot),/MIGRATION_CANCELLED/);
 assert.equal(f.session.journal.get().phase,"PREPARING");
 const state={...f.state,devices:new Map(f.state.devices)};
 state.devices.set("owner",{...state.devices.get("owner"),role:"read"});
 await assert.rejects(createMigrationRequest({state,device:f.device,deviceId:"owner",epoch:"1",operation:"status",parameters:{migrationId:"one"}}),/DEVICE_FORBIDDEN/);
});
