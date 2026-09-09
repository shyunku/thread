const {test}=require("node:test"),assert=require("node:assert/strict");
const recovery=require("../public/electron/e2ee/recovery"),file=require("../public/electron/e2ee/recoveryFile");
test("recovery code checksum and scoped encrypted file roundtrip",async()=>{
 const scope={vaultId:"fixture",genesisFingerprint:"a".repeat(64)},keyring={generation:1,key:Buffer.alloc(32,7)},authority=Buffer.alloc(64,8);
 const {secret,bundle}=await recovery.createRecovery(scope.vaultId,scope.genesisFingerprint,keyring,authority);
 const code=file.formatCode(secret),bytes=file.exportBundle(bundle);assert.deepEqual(file.parseCode(code.toLowerCase()),secret);
 assert.equal(bytes.includes(secret),false);assert.equal(bytes.includes(authority),false);
 assert.deepEqual((await file.unlockBundle(code,bytes,scope)).keyring,keyring);
 const changed=code.slice(0,-1)+(code.endsWith("0")?"1":"0");assert.throws(()=>file.parseCode(changed),/CHECKSUM/);
 assert.throws(()=>file.importBundle(bytes,{...scope,vaultId:"other"}),/SCOPE/);
 const wrong=file.formatCode(Buffer.alloc(32,4));await assert.rejects(file.unlockBundle(wrong,bytes,scope));
 const corrupted=Buffer.from(bytes);corrupted[corrupted.length-1]^=1;await assert.rejects(file.unlockBundle(code,corrupted,scope));
 secret.fill(0);
});
