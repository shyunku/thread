const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),owner=require("../public/electron/e2ee/ownerIdentity"),{registerOwner}=require("../public/electron/e2ee/ownerRegistration"),p=require("../public/electron/e2ee/protocol");
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-registration-")),filename=path.join(dir,"vault.db"),key=Buffer.alloc(32,3),scope={environment:"development",accountId:"fixture",vaultId:"fixture"};
 let store=new EncryptedStore({filename,key,scope,create:true}),remote=null,count=0,lose=false;
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 await owner.prepareOwner(store);
 const transport={
  membership:async()=>{if(!remote)throw Error("VAULT_NOT_FOUND");return {genesis:p.encode(remote).toString("base64"),head:{vaultId:"fixture",revision:0,digest:p.fingerprint(remote.body)},records:[],next:0,more:false};},
  createVault:async genesis=>{count++;remote=genesis;if(lose){lose=false;throw Error("LOST_ACK");}}
 };
 return {get store(){return store;},transport,get creates(){return count;},get remote(){return remote;},set remote(value){remote=value;},
  lose:()=>{lose=true;},reopen:()=>{store.close();store=new EncryptedStore({filename,key,scope});},
  confirm:async()=>{const kit=owner.recoveryMaterial(store);await owner.confirmOwnerRecovery(store,kit.code,kit.bytes);}};
}
test("registration requires recovery proof, resumes after lost ACK and never recreates confirmed missing server data",async t=>{
 const f=await fixture(t);
 await assert.rejects(registerOwner(f),/RECOVERY_CONFIRMATION/);assert.equal(f.creates,0);
 await f.confirm();f.lose();await assert.rejects(registerOwner(f),/LOST_ACK/);
 f.reopen();assert.equal((await registerOwner(f)).phase,"REGISTERED");assert.equal(f.creates,1);
 assert.equal((await registerOwner(f)).phase,"REGISTERED");assert.equal(f.creates,1);
 f.remote=null;await assert.rejects(registerOwner(f),/SERVER_VAULT_MISSING/);assert.equal(f.creates,1);
});
test("different remote identity and generic network failures never trigger replacement",async t=>{
 const f=await fixture(t);await f.confirm();
 const own=f.store.get("recovery","$owner-identity").genesis;
 f.remote={...own,body:{...own.body,vaultId:"other"}};
 assert.equal((await registerOwner(f)).phase,"PAIRING_REQUIRED");assert.equal(f.creates,0);
 f.transport.membership=async()=>{throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(registerOwner(f),/SYNC_UNAVAILABLE/);assert.equal(f.creates,0);
});
test("lock cancellation after missing-server lookup prevents registration",async t=>{
 const f=await fixture(t);await f.confirm();const abort=new AbortController();
 f.transport.membership=async()=>{abort.abort();throw Error("VAULT_NOT_FOUND");};
 await assert.rejects(registerOwner({...f,signal:abort.signal}),/SYNC_CANCELLED/);assert.equal(f.creates,0);
});
