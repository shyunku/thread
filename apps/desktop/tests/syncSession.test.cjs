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

async function rotate(f,{epoch="epoch",recipients}={}){
 const {MembershipHistory}=require("../public/electron/e2ee/readProtocol"),{proposeTransition}=require("../public/electron/e2ee/keyTransition");
 const identity=f.store.get("recovery","$owner-identity");
 if(!f.history)f.history=await new MembershipHistory(identity.genesis,identity.fingerprint).initialize();
 f.records??=[];
 const proposal=await proposeTransition({state:f.history.current,epoch,deviceId:identity.deviceId,device:identity.device,
  recipients:recipients||[f.history.current.devices.get(identity.deviceId)],keys:f.serverKeys||identity.keyring.keys});
 f.records.push(proposal.record);await f.history.append(proposal.record);f.serverKeys=proposal.keyring.keys;
 Object.assign(f.state,{revision:f.history.current.revision,keyGeneration:f.history.current.keyGeneration,head:f.history.current.head});
 f.transport.membership=async after=>({genesis:p.encode(identity.genesis).toString("base64"),head:{vaultId:"fixture",revision:f.state.revision,digest:f.state.head},
  records:f.records.filter(r=>r.body.revision>after).map(r=>p.encode(r).toString("base64")),next:f.state.revision,more:false});
 f.transport.snapshot=async()=>({id:"00000000-0000-0000-0000-000000000001",epoch:"epoch",seq:"0",membershipHead:f.state.head,count:0,digest:createHash("sha256").digest("hex")});
}
test("offline owner refreshes multiple signed generations and retains historical keys",async t=>{
 const f=await fixture(t),before=f.store.get("recovery","$owner-identity").keyring;
 await rotate(f);await rotate(f);
 const session=await openSyncSession(f);t.after(()=>session.close());
 const saved=f.store.get("recovery","$owner-identity").keyring;
 assert.equal(saved.keyGeneration,3);assert.deepEqual(saved.keys[0],before.keys[0]);
 assert.equal((await session.engine.context()).state.keyGeneration,3);
});
test("an open session refreshes rotated keys on the next sync",async t=>{
 const f=await fixture(t),session=await openSyncSession(f);t.after(()=>session.close());
 await rotate(f);await session.engine.run();
 assert.equal(f.store.get("recovery","$owner-identity").keyring.keyGeneration,2);
 const context=await session.engine.context();assert.deepEqual(context.key,f.serverKeys[1].key);context.key.fill(0);
});
test("wrong epoch transition preserves stored keyring and replica",async t=>{
 const f=await fixture(t),before=f.store.get("recovery","$owner-identity");
 await rotate(f,{epoch:"other"});
 await assert.rejects(openSyncSession(f),/INVALID_KEYRING/);
 assert.deepEqual(f.store.get("recovery","$owner-identity"),before);
 assert.equal(f.store.get("confirmed","$sync-state"),null);
});
test("revoked device cannot refresh keys or install a snapshot",async t=>{
 const f=await fixture(t),before=f.store.get("recovery","$owner-identity"),fresh=await p.createDevice();
 await rotate(f,{recipients:[{id:"replacement",signingKey:fresh.signing.publicKey,encryptionKey:fresh.encryption.publicKey,role:"write",canAuthorizeDevices:true}]});
 await assert.rejects(openSyncSession(f),/DEVICE_FORBIDDEN/);
 assert.deepEqual(f.store.get("recovery","$owner-identity"),before);
 assert.equal(f.store.get("confirmed","$sync-state"),null);
});
test("cancellation during key unwrap never commits the new keyring",async t=>{
 const f=await fixture(t),identity=f.store.get("recovery","$owner-identity"),{refreshSessionKeys}=require("../public/electron/e2ee/sessionKeys");
 await rotate(f);let checks=0;
 await assert.rejects(refreshSessionKeys({...f,identityKey:"$owner-identity",identity,history:f.history,epoch:"epoch",ready:()=>{if(++checks===2)throw Error("SYNC_CANCELLED");}}),/SYNC_CANCELLED/);
 assert.deepEqual(f.store.get("recovery","$owner-identity"),identity);
});
test("concurrent identity update is not overwritten by key refresh",async t=>{
 const f=await fixture(t),identity=f.store.get("recovery","$owner-identity"),{refreshSessionKeys}=require("../public/electron/e2ee/sessionKeys");
 await rotate(f);let checks=0;const changed={...identity,marker:"concurrent"};
 await assert.rejects(refreshSessionKeys({...f,identityKey:"$owner-identity",identity,history:f.history,epoch:"epoch",ready:()=>{if(++checks===2)f.store.put("recovery","$owner-identity",changed);}}),/IDENTITY_CHANGED/);
 assert.deepEqual(f.store.get("recovery","$owner-identity"),changed);
});
test("signed replacement of a known historical key is refused",async t=>{
 const f=await fixture(t),before=f.store.get("recovery","$owner-identity");
 f.serverKeys=[{generation:1,key:Buffer.alloc(32,99)}];await rotate(f);
 await assert.rejects(openSyncSession(f),/HISTORICAL_KEY_CHANGED/);
 assert.deepEqual(f.store.get("recovery","$owner-identity"),before);
});
