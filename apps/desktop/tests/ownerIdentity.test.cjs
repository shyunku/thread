const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),owner=require("../public/electron/e2ee/ownerIdentity");
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-owner-")),filename=path.join(dir,"vault.db"),key=Buffer.alloc(32,4),scope={environment:"development",accountId:"fixture",vaultId:"fixture"};
 let store=new EncryptedStore({filename,key,scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},reopen(){store.close();store=new EncryptedStore({filename,key,scope});}};
}
test("owner preparation persists without replacement and requires recovery decryption before confirmation",async t=>{
 const f=fixture(t),first=await owner.prepareOwner(f.store);
 assert.equal(first.phase,"RECOVERY_UNCONFIRMED");assert.equal(Object.hasOwn(first,"device"),false);
 const material=owner.recoveryMaterial(f.store);f.reopen();
 assert.deepEqual(await owner.prepareOwner(f.store),first);
 await assert.rejects(owner.confirmOwnerRecovery(f.store,"wrong",material.bytes));
 assert.equal(owner.ownerStatus(f.store).phase,"RECOVERY_UNCONFIRMED");
 const altered=Buffer.from(material.bytes);altered[altered.length-1]^=1;
 await assert.rejects(owner.confirmOwnerRecovery(f.store,material.code,altered));
 assert.equal((await owner.confirmOwnerRecovery(f.store,material.code,material.bytes)).phase,"RECOVERY_CONFIRMED");
 f.reopen();assert.equal(owner.ownerStatus(f.store).phase,"RECOVERY_CONFIRMED");
 assert.equal(owner.recoveryMaterial(f.store).code,material.code);
});
test("a locked store cannot expose material or initialize a replacement",async t=>{
 const f=fixture(t);await owner.prepareOwner(f.store);f.store.close();
 assert.throws(()=>owner.recoveryMaterial(f.store),/LOCKED/);
 await assert.rejects(owner.prepareOwner(f.store),/LOCKED/);
});
