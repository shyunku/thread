const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const crypto=require("node:crypto");
const p=require("../public/electron/e2ee/protocol");
const {EncryptedStore,VaultSession}=require("../public/electron/e2ee/localStore");
const {validateTarget,TrustedUpdates}=require("../public/electron/e2ee/trustedUpdates");
const ctx={vaultId:"v1",vaultEpoch:"1",objectId:"task1",fieldSlot:1,keyGeneration:1,mutationId:"m1",deviceId:"d1"};
test("published AEAD vector matches the implementation",async()=>{
 const v=require("../../../docs/protocol/e2ee-v1-vector.json");
 assert.equal(p.derive(Buffer.from(v.secretHex,"hex"),"field",v.context).toString("hex"),v.derivedKeyHex);
 assert.equal(p.encode([p.SUITE,v.context]).toString("hex"),v.aadHex);
 const value=await p.decrypt(Buffer.from(v.secretHex,"hex"),v.context,{nonce:Buffer.from(v.nonceHex,"hex"),ciphertext:Buffer.from(v.ciphertextHex,"hex")});
 assert.equal(p.encode(value).toString("hex"),v.plaintextHex);
});
test("deterministic encoding and strict decoder",()=>{
 assert.equal(p.encode({b:2,a:1}).toString("hex"),"a2616101616202");
 assert.deepEqual(p.decode(p.encode(ctx)),ctx);
 assert.throws(()=>p.decode(Buffer.from("1801","hex")),/NON_CANONICAL/);
 assert.throws(()=>p.encode({a:NaN}));
 assert.throws(()=>p.decode(Buffer.concat([p.encode(1),p.encode(2)])));
});
test("field AEAD authenticates every context field, rejects tampering, fresh nonce",async()=>{
 const key=crypto.randomBytes(32), value={title:"synthetic-private",memo:"fixture"};
 const encrypted=await p.encrypt(key,ctx,value);
 assert.deepEqual(await p.decrypt(key,ctx,encrypted),value);
 const next=await p.encrypt(key,ctx,value);
 assert.notDeepEqual(encrypted.nonce,next.nonce);
 for(const field of Object.keys(ctx)){
  const changed={...ctx,[field]:typeof ctx[field]==="number"?ctx[field]+1:ctx[field]+"x"};
  await assert.rejects(p.decrypt(key,changed,encrypted));
 }
 const bad=Buffer.from(encrypted.ciphertext);bad[0]^=1;
 await assert.rejects(p.decrypt(key,ctx,{...encrypted,ciphertext:bad}));
 assert.notDeepEqual(p.derive(key,"field",ctx),p.derive(key,"recovery",ctx));
});
test("signatures bind metadata and purpose; sealed pairing binds request and recipient",async()=>{
 const sender=await p.createDevice(), recipient=await p.createDevice(), other=await p.createDevice();
 const body={counter:"1",membershipRevision:"1",changes:[ctx]};
 const sig=await p.sign(sender.signing.privateKey,"mutation",body);
 await p.verify(sender.signing.publicKey,"mutation",body,sig);
 await assert.rejects(p.verify(sender.signing.publicKey,"genesis",body,sig));
 await assert.rejects(p.verify(sender.signing.publicKey,"mutation",{...body,counter:"2"},sig));
 const now=Date.now(), request={nonce:"synthetic-challenge",expiresAt:now+60000};
 const response=await p.seal(recipient.encryption.publicKey,sender.signing.privateKey,request,{vdk:Buffer.alloc(32,7)});
 assert.deepEqual(await p.unseal(recipient.encryption,sender.signing.publicKey,response,request,now),{vdk:Buffer.alloc(32,7)});
 await assert.rejects(p.unseal(other.encryption,sender.signing.publicKey,response,request,now));
 await assert.rejects(p.unseal(recipient.encryption,sender.signing.publicKey,response,request,now+60001));
});
test("encrypted DB/WAL hides all buckets, reopens, rejects wrong key/scope without reset",()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"thread-e2ee-fixture-"));
 const filename=path.join(temp,"vault.db"), key=crypto.randomBytes(32);
 const scope={environment:"development",accountId:"fixture",vaultId:"v1"};
 let store;
 try {
  store=new EncryptedStore({filename,key,scope,create:true});
  const marker="SYNTHETIC_PRIVATE_CONTENT_45fa46";
  for(const bucket of ["confirmed","visible","outbox","search","recovery"])store.put(bucket,"one",{title:marker});
  assert.throws(()=>store.transaction(s=>{s.put("outbox","rollback",{title:marker});throw Error("fixture");}));
  assert.equal(store.get("outbox","rollback"),null);
  for(const name of fs.readdirSync(temp)){
   const bytes=fs.readFileSync(path.join(temp,name));
   assert.equal(bytes.includes(Buffer.from(marker)),false,name);
   assert.equal(bytes.includes(Buffer.from("SQLite format 3")),false,name);
  }
  store.close();
  assert.throws(()=>store.get("visible","one"),/VAULT_LOCKED/);
  assert.throws(()=>new EncryptedStore({filename,key:crypto.randomBytes(32),scope}));
  assert.throws(()=>new EncryptedStore({filename,key,scope:{...scope,accountId:"other"}}),/SCOPE/);
  store=new EncryptedStore({filename,key,scope});
  assert.equal(store.get("outbox","one").title,marker);
  assert.throws(()=>new EncryptedStore({filename,key,scope,create:true}),/EEXIST/);
 } finally {store?.close();key.fill(0);fs.rmSync(temp,{recursive:true,force:true});}
});
test("locking while authentication is pending cannot reopen the vault",async()=>{
 let resolve,opened=0,cleared=0;
 const session=new VaultSession({reauthenticate:()=>new Promise(r=>resolve=r),
  openStore:()=>{opened++;return{close(){}}},clearRenderer:()=>cleared++});
 const pending=session.unlock();
 session.lock();resolve(true);
 await assert.rejects(pending,/UNLOCK_CANCELLED/);
 assert.equal(opened,0);assert.equal(cleared,1);
 assert.throws(()=>session.use(()=>{}),/VAULT_LOCKED/);
});
test("unavailable reauthentication fails closed",async()=>{
 const session=new VaultSession({reauthenticate:async()=>false,openStore:()=>assert.fail(),clearRenderer(){}});
 await assert.rejects(session.unlock(),/REAUTH_REQUIRED/);
});
test("signed target custom fields reject wrong platform, rollback, malformed mandatory",()=>{
 const options={platform:"win",arch:"ia32",version:"1.1.4",installedVersion:"1.1.3"};
 const info={length:123,custom:{thread:{schema:1,platform:"win",arch:"ia32",version:"1.1.4",mandatory:true}}};
 assert.equal(validateTarget(info,options).mandatory,true);
 assert.throws(()=>validateTarget(info,{...options,arch:"x64"}));
 assert.throws(()=>validateTarget(info,{...options,installedVersion:"1.1.4"}));
 assert.throws(()=>validateTarget({...info,custom:{thread:{...info.custom.thread,mandatory:"true"}}},options));
 assert.throws(()=>new TrustedUpdates({rootFile:null,cacheDir:".",repositoryURL:"https://example.invalid/",...options}),/TRUST_NOT_CONFIGURED/);
});
