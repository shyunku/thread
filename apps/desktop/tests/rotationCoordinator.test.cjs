const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership"),owner=require("../public/electron/e2ee/ownerIdentity");
const rotation=require("../public/electron/e2ee/rotationCoordinator"),{EncryptedStore}=require("../public/electron/e2ee/localStore");
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-rotation-")),scope={environment:"development",accountId:"fixture",vaultId:"fixture"};
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,4),scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 await owner.prepareOwner(store);const material=owner.recoveryMaterial(store);await owner.confirmOwnerRecovery(store,material.code,material.bytes);
 const identity=store.get("recovery","$owner-identity");
 store.put("confirmed","$sync-state",{scope:{vaultId:"fixture",deviceId:identity.deviceId,epoch:"1"},cursor:"0",counter:"0",deviceCounters:[]});
 let state=await m.verifyGenesis(identity.genesis,identity.fingerprint);const records=[];
 const transport={
  accountStatus:async()=>({accountMode:"e2ee",epoch:"1",head:state.head}),
  membership:async after=>({genesis:p.encode(identity.genesis).toString("base64"),head:{vaultId:"fixture",revision:state.revision,digest:state.head},records:records.filter(row=>row.body.revision>after).map(row=>p.encode(row).toString("base64")),next:state.revision,more:false}),
  transition:async record=>{state=await m.applyTransition(state,record);records.push(record);return {};}
 };
 return {store,transport,identity,ready:()=>{},records};
}
test("rotation requires confirmed recovery, reuses exact signed transition after unknown ACK and changes keys atomically",async t=>{
 const f=await fixture(t),before=p.encode(f.store.get("recovery","$owner-identity"));
 await assert.rejects(rotation.prepare({...f,remove:[f.identity.deviceId]}),/INVALID_DEVICE/);
 assert.equal((await rotation.prepare({...f,remove:[]})).phase,"RECOVERY_UNCONFIRMED");
 assert.deepEqual(p.encode(f.store.get("recovery","$owner-identity")),before);
 await assert.rejects(rotation.commit(f),/RECOVERY_CONFIRMATION/);
 const material=rotation.material(f.store);
 await assert.rejects(rotation.confirm({...f,code:"wrong",bytes:material.bytes}));
 assert.equal((await rotation.confirm({...f,...material})).phase,"RECOVERY_CONFIRMED");
 const send=f.transport.transition;let calls=0;
 f.transport.transition=async record=>{calls++;await send(record);throw Error("UNKNOWN_ACK");};
 await assert.rejects(rotation.commit(f),/UNKNOWN_ACK/);
 assert.equal(rotation.status(f.store).phase,"COMMITTING");
 assert.deepEqual(p.encode(f.store.get("recovery","$owner-identity")),before);
 assert.throws(()=>rotation.cancel(f.store),/CANCEL_UNSAFE/);
 await assert.rejects(require("../public/electron/e2ee/syncSession").openSyncSession({store:f.store,transport:f.transport}),/RECONCILE_REQUIRED/);
 assert.equal((await rotation.commit(f)).phase,"ACTIVE");assert.equal(calls,1);
 assert.equal(f.store.get("recovery","$owner-identity").keyring.keyGeneration,2);
 assert.equal((await owner.confirmOwnerRecovery(f.store,material.code,material.bytes)).phase,"RECOVERY_CONFIRMED");
});
test("unsubmitted cancellation preserves old identity and a cancelled proposal",async t=>{
 const f=await fixture(t),before=p.encode(f.store.get("recovery","$owner-identity"));
 await rotation.prepare({...f,remove:[]});
 assert.equal(rotation.cancel(f.store).phase,"CANCELLED");
 assert.deepEqual(p.encode(f.store.get("recovery","$owner-identity")),before);
 assert.equal(f.records.length,0);
 await rotation.prepare({...f,remove:[]});assert.equal(f.store.entries("recovery").filter(row=>row.id.startsWith("$rotation-history-1-")).length,1);
});
