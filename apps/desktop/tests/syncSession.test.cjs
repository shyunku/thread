const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{createHash}=require("node:crypto");
const p=require("../public/electron/e2ee/protocol"),owner=require("../public/electron/e2ee/ownerIdentity"),{EncryptedStore}=require("../public/electron/e2ee/localStore"),{openSyncSession}=require("../public/electron/e2ee/syncSession");
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-sync-session-")),store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,2),scope:{environment:"development",accountId:"fixture",vaultId:"fixture"},create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 await owner.prepareOwner(store);const kit=owner.recoveryMaterial(store);await owner.confirmOwnerRecovery(store,kit.code,kit.bytes);
 const identity=store.get("recovery","$owner-identity");
 const state={vaultId:"fixture",accountMode:"e2ee",vaultMode:"active",epoch:"epoch",revision:0,keyGeneration:1,head:identity.fingerprint};
 const transport={accountStatus:async()=>state,membership:async()=>({genesis:p.encode(identity.genesis).toString("base64"),head:{vaultId:"fixture",revision:0,digest:identity.fingerprint},records:[],next:0,more:false}),
  snapshot:async record=>{await p.verify(identity.device.signing.publicKey,"request",record.body,record.signature);return {id:"00000000-0000-0000-0000-000000000001",epoch:"epoch",seq:"0",membershipHead:identity.fingerprint,count:0,digest:createHash("sha256").digest("hex")};},
  snapshotPage:async()=>({objects:[],next:"",more:false}),pull:async()=>({changes:[],until:"0",next:"0",more:false})};
 return {store,transport,state};
}
test("unmigrated account never initializes a replica or sends a snapshot request",async t=>{
 const f=await fixture(t);f.state.accountMode="v2";f.state.vaultMode="pending";
 f.transport.snapshot=async()=>{throw Error("MUST_NOT_CALL");};
 assert.deepEqual(await openSyncSession(f),{phase:"WAITING_FOR_MIGRATION"});
 assert.equal(f.store.get("confirmed","$sync-state"),null);
});
test("active session installs verified initial snapshot atomically and closes on lock signal",async t=>{
 const f=await fixture(t),abort=new AbortController(),session=await openSyncSession({...f,signal:abort.signal});
 assert.equal(session.phase,"ACTIVE");assert.equal(f.store.get("confirmed","$sync-state").scope.epoch,"epoch");
 assert.deepEqual(await session.engine.run(),{cursor:"0",pending:0,conflicts:0});
 abort.abort();await assert.rejects(session.engine.run(),/SYNC_CANCELLED/);
 assert.equal(f.store.get("recovery","$owner-identity").device.signing.privateKey.some(byte=>byte!==0),true);
});
test("invalid snapshot leaves a new replica unbound; next valid attempt succeeds",async t=>{
 const f=await fixture(t),valid=f.transport.snapshot;
 f.transport.snapshot=async record=>({...await valid(record),digest:"a".repeat(64)});
 await assert.rejects(openSyncSession(f),/DIGEST/);
 assert.equal(f.store.get("confirmed","$sync-state"),null);
 f.transport.snapshot=valid;const session=await openSyncSession(f);session.close();
});
