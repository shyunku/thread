const {test}=require("node:test");
const assert=require("node:assert/strict"),crypto=require("node:crypto");
const p=require("../public/electron/e2ee/protocol");
const {createRecovery,recover}=require("../public/electron/e2ee/recovery");
test("recovery requires correct secret and pinned genesis",async()=>{
 const authority=await p.createDevice(), fingerprint="a".repeat(64), scope={vaultId:"fixture",genesisFingerprint:fingerprint};
 const kit=await createRecovery(scope.vaultId,fingerprint,{generations:[Buffer.alloc(32,9)]},authority.signing.privateKey);
 const opened=await recover(kit.secret,kit.bundle,scope);
 assert.deepEqual(opened.recoveryAuthoritySecret,authority.signing.privateKey);
 assert.deepEqual(opened.keyring.generations[0],Buffer.alloc(32,9));
 await assert.rejects(recover(crypto.randomBytes(32),kit.bundle,scope));
 await assert.rejects(recover(kit.secret,kit.bundle,{...scope,genesisFingerprint:"b".repeat(64)}));
 assert.equal(p.derive(Buffer.alloc(32,1),"field",{vaultId:"synthetic-vault"}).toString("hex"),"5c472e636e062bf7ece6e2ba62ea5acb87f178372d8652734e74a6da9df1a3cd");
});
