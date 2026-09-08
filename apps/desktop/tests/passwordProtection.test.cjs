const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {randomBytes,createCipheriv,createDecipheriv}=require("node:crypto");
const password=require("../public/electron/e2ee/passwordProtection");
const {LocalVault}=require("../public/electron/e2ee/localVault");
const {encode,decode}=require("../public/electron/e2ee/protocol");
const context={environment:"development",accountId:"fixture",purpose:"ldk:vault"};
test("Argon2id envelope unlocks the key and rejects wrong password, context and parameters",async()=>{
 const key=randomBytes(32), secret="synthetic long password";
 const wrapped=await password.protect(key,secret,context);
 assert.deepEqual(await password.unprotect(wrapped,secret,context),key);
 assert.equal(wrapped.includes(Buffer.from(secret)),false);
 assert.equal(wrapped.includes(key),false);
 await assert.rejects(password.unprotect(wrapped,"incorrect password",context),/INVALID_PASSWORD/);
 await assert.rejects(password.unprotect(wrapped,secret,{...context,accountId:"other"}),/INVALID_PASSWORD/);
 const edited=decode(wrapped);edited.kdf.memory=1024;
 await assert.rejects(password.unprotect(encode(edited),secret,context),/ENVELOPE/);
 await assert.rejects(password.protect(key,"1234",context),/INVALID_VAULT_PASSWORD/);
});
test("password and OS key paths open the same encrypted store without saving passwords",async t=>{
 const baseDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"thread-password-"));
 t.after(()=>fs.rmSync(baseDirectory,{recursive:true,force:true}));
 const osKey=randomBytes(32);
 const protector={
  protect(key){const nonce=randomBytes(12),c=createCipheriv("aes-256-gcm",osKey,nonce);return Buffer.concat([nonce,c.update(key),c.final(),c.getAuthTag()]);},
  unprotect(data){const c=createDecipheriv("aes-256-gcm",osKey,data.subarray(0,12));c.setAuthTag(data.subarray(-16));return Buffer.concat([c.update(data.subarray(12,-16)),c.final()]);}
 };
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};
 const vault=new LocalVault({baseDirectory,scope,protector});
 await vault.createWithPassword("synthetic vault password");
 let store=vault.open();store.put("outbox","one",{title:"SYNTHETIC_SECRET"});store.close();
 store=await vault.openWithPassword("synthetic vault password");
 assert.equal(store.get("outbox","one").title,"SYNTHETIC_SECRET");store.close();
 await assert.rejects(vault.openWithPassword("wrong password"));
 for(const dir of fs.readdirSync(baseDirectory))for(const name of fs.readdirSync(path.join(baseDirectory,dir))) {
  const bytes=fs.readFileSync(path.join(baseDirectory,dir,name));
  assert.equal(bytes.includes(Buffer.from("synthetic vault password")),false);
 }
});
