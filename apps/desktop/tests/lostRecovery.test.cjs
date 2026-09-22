const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership"),owner=require("../public/electron/e2ee/ownerIdentity");
const recovery=require("../public/electron/e2ee/lostRecovery"),{EncryptedStore}=require("../public/electron/e2ee/localStore");
async function fixture(t,migrating=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-lost-recovery-")),scope={environment:"development",accountId:"synthetic",vaultId:"fixture"};
 const stores=["old","new"].map(name=>new EncryptedStore({filename:path.join(dir,name+".db"),key:Buffer.alloc(32,5),scope,create:true}));
 t.after(()=>{stores.forEach(store=>store.close());fs.rmSync(dir,{recursive:true,force:true});});
 await owner.prepareOwner(stores[0]);const material=owner.recoveryMaterial(stores[0]);await owner.confirmOwnerRecovery(stores[0],material.code,material.bytes);
 const identity=stores[0].get("recovery","$owner-identity"),records=[];let state=await m.verifyGenesis(identity.genesis,identity.fingerprint);
 let pending=migrating;
 const transport={
  membership:async after=>({genesis:p.encode(identity.genesis).toString("base64"),head:{vaultId:"fixture",revision:state.revision,digest:state.head},records:records.filter(row=>row.body.revision>after).map(row=>p.encode(row).toString("base64")),next:state.revision,more:false}),
  accountStatus:async()=>({accountMode:migrating?(pending?"e2ee_frozen":"v2"):"e2ee",vaultMode:migrating?(pending?"migrating":"pending"):"active",vaultId:"fixture",epoch:pending?"temporary":"1",revision:state.revision,head:state.head,keyGeneration:state.keyGeneration}),
  recoverPending:async record=>{state=await m.applyRecovery(state,record);records.push(record);pending=false;},
  transition:async record=>{state=await m.applyTransition(state,record);records.push(record);}
 };
 return {store:stores[1],original:stores[0],transport,material,identity,records,ready:()=>{},state:()=>state};
}
test("full loss uses a new device, confirms a new kit and reconciles an accepted transition with lost ACK",async t=>{
 const f=await fixture(t);await recovery.prepare({...f,...f.material});
 assert.equal(f.store.get("recovery","$owner-identity"),null);assert.equal(f.records.length,0);
 await assert.rejects(recovery.commit(f),/RECOVERY_CONFIRMATION_REQUIRED/);
 const material=recovery.material(f.store);await recovery.confirm({...f,...material});
 const send=f.transport.transition;let calls=0;
 f.transport.transition=async record=>{calls++;await send(record);throw Error("UNKNOWN_ACK");};
 await assert.rejects(recovery.commit(f),/UNKNOWN_ACK/);
 assert.equal(recovery.status(f.store).phase,"COMMITTING");assert.equal(f.store.get("recovery","$owner-identity"),null);
 assert.throws(()=>recovery.cancel(f.store),/RECOVERY_CANCEL_UNSAFE/);
 assert.equal((await recovery.commit(f)).phase,"ACTIVE");assert.equal(calls,1);
 const next=f.store.get("recovery","$owner-identity");
 assert.notEqual(next.deviceId,f.identity.deviceId);assert.equal(f.state().devices.has(f.identity.deviceId),false);
 assert.equal(next.keyring.keyGeneration,2);assert.deepEqual(next.keyring.keys[0],f.identity.keyring.keys[0]);
 assert.equal((await owner.confirmOwnerRecovery(f.store,material.code,material.bytes)).phase,"RECOVERY_CONFIRMED");
 assert.deepEqual(f.original.get("recovery","$owner-identity"),f.identity);
});
test("lost migration coordinator switches to pending recovery and reconciles cancellation after lost ACK",async t=>{
 const f=await fixture(t,true);await recovery.prepare({...f,...f.material});
 const material=recovery.material(f.store);await recovery.confirm({...f,...material});
 const send=f.transport.recoverPending;
 f.transport.recoverPending=async record=>{await send(record);throw Error("UNKNOWN_ACK");};
 await assert.rejects(recovery.commit(f),/UNKNOWN_ACK/);
 assert.equal((await recovery.commit(f)).phase,"ACTIVE");assert.equal(f.records.length,1);
 assert.equal(f.records[0].body.schema,undefined);assert.equal((await f.transport.accountStatus()).vaultMode,"pending");
});
test("wrong kit, existing local identity, late lock and unconfirmed recovery never publish",async t=>{
 const f=await fixture(t);
 await assert.rejects(recovery.prepare({...f,...f.material,code:"invalid"}));assert.equal(recovery.status(f.store),null);
 await assert.rejects(recovery.prepare({...f,...f.material,store:f.original}),/FRESH_VAULT_REQUIRED/);
 let checks=0;await assert.rejects(recovery.prepare({...f,...f.material,ready:()=>{if(++checks>1)throw Error("LOCKED");}}),/LOCKED/);
 assert.equal(recovery.status(f.store),null);assert.equal(f.records.length,0);
 await recovery.prepare({...f,...f.material});
 assert.equal(recovery.cancel(f.store).phase,"CANCELLED");
 await recovery.prepare({...f,...f.material});
 assert.equal(f.store.entries("recovery").filter(row=>row.id.startsWith("$lost-recovery-history-")).length,1);
 await assert.rejects(recovery.confirm({...f,...f.material}),/RECOVERY_CONTENT_MISMATCH/);
});
