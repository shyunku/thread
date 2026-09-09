const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership");
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-replica-fixture-"));const filename=path.join(dir,"vault.db"),key=Buffer.alloc(32,2);
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};let store=new EncryptedStore({filename,key,scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const device=await p.createDevice(),body={schema:1,vaultId:"vault",recoveryKey:Buffer.alloc(32,1),owner:{id:"owner",role:"write",canAuthorizeDevices:true,signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey}};
 const state=await m.verifyGenesis({body,signature:await p.sign(device.signing.privateKey,"genesis",body)},p.fingerprint(body));
 const context={device,state,deviceId:"owner",epoch:"1",key:Buffer.alloc(32,3)};
 const replicaScope={vaultId:"vault",epoch:"1",deviceId:"owner"};
 return {get store(){return store;},replica:new EncryptedReplica(store,replicaScope),context,
  reopen(){store.close();store=new EncryptedStore({filename,key,scope});return new EncryptedReplica(store,replicaScope);},dir};
}
const changes=[{objectId:"task",baseVersion:"0",deleted:false,fields:[{slot:1,value:{title:"SYNTHETIC_PENDING_PRIVATE"}}]}];
test("draft and exact signed retry survive encrypted DB restart before ACK",async t=>{
 const f=await fixture(t);const id=f.replica.enqueue(changes);assert.equal(f.store.get("confirmed","task"),null);
 const record=await f.replica.prepare(id,f.context);const reopened=f.reopen();assert.deepEqual(await reopened.prepare(id,f.context),record);
 assert.equal(f.store.get("visible","task").pending,true);
 await assert.rejects(reopened.applyChange({record,result:{seq:"1",versions:{task:"9"}}},f.context));
 assert.equal(reopened.pending().length,1);
 await reopened.applyChange({record,result:{seq:"1",versions:{task:"1"}}},f.context);
 assert.equal(reopened.pending().length,0);assert.equal(f.store.get("visible","task").pending,false);
 assert.equal(f.store.get("confirmed","task").fields[0].value.title,"SYNTHETIC_PENDING_PRIVATE");
 await assert.rejects(reopened.applyChange({record,result:{seq:"1",versions:{task:"1"}}},f.context),/CURSOR/);
 for(const name of fs.readdirSync(f.dir))assert.equal(fs.readFileSync(path.join(f.dir,name)).includes(Buffer.from("SYNTHETIC_PENDING_PRIVATE")),false);
});
test("conflicted draft remains recoverable and overlapping queued edits are not discarded",async t=>{
 const f=await fixture(t);const id=f.replica.enqueue(changes);assert.throws(()=>f.replica.enqueue(changes),/PENDING_OBJECT_EXISTS/);
 await f.replica.prepare(id,f.context);f.replica.preserveConflict(id);
 assert.deepEqual(f.store.get("recovery",id).changes,changes);assert.equal(f.replica.pending()[0].value.status,"conflict");
 await assert.rejects(f.replica.prepare(id,f.context),/DRAFT_UNAVAILABLE/);
});
test("locking during preparation cannot persist a late signed draft",async t=>{
 const f=await fixture(t);const id=f.replica.enqueue(changes);const pending=f.replica.prepare(id,f.context);f.store.close();
 await assert.rejects(pending,/LOCKED/);const reopened=f.reopen();assert.equal(reopened.pending()[0].value.status,"draft");
});
