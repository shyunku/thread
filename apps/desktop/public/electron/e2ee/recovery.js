const sodium=require("libsodium-wrappers");
const p=require("./protocol");
function context(vaultId,genesisFingerprint) {
 if(typeof vaultId!=="string" || !vaultId || !/^[a-f0-9]{64}$/.test(genesisFingerprint))throw Error("INVALID_RECOVERY_CONTEXT");
 return {vaultId,genesisFingerprint};
}
async function createRecovery(vaultId,genesisFingerprint,keyring,recoveryAuthoritySecret) {
 await sodium.ready;
 if(!Buffer.isBuffer(recoveryAuthoritySecret)||recoveryAuthoritySecret.length!==64)throw Error("INVALID_RECOVERY_AUTHORITY");
 const scope=context(vaultId,genesisFingerprint), secret=Buffer.from(sodium.randombytes_buf(32));
 const key=p.derive(secret,"recovery",scope), nonce=Buffer.from(sodium.randombytes_buf(24));
 const plaintext=p.encode({keyring,recoveryAuthoritySecret});
 try {
  const ciphertext=Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext,p.encode([p.SUITE,"recovery",scope]),null,nonce,key));
  return {secret,bundle:{schema:1,...scope,nonce,ciphertext}};
 } finally {key.fill(0);plaintext.fill(0);}
}
async function recover(secret,bundle,expectedScope) {
 await sodium.ready;
 const scope=context(expectedScope.vaultId,expectedScope.genesisFingerprint);
 if(bundle.schema!==1 || bundle.vaultId!==scope.vaultId || bundle.genesisFingerprint!==scope.genesisFingerprint ||
    !Buffer.isBuffer(bundle.nonce)||bundle.nonce.length!==24||
    !Buffer.isBuffer(bundle.ciphertext)||bundle.ciphertext.length>p.MAX_BYTES+16)throw Error("INVALID_RECOVERY_BUNDLE");
 const key=p.derive(secret,"recovery",scope);
 let plaintext;
 try {
  plaintext=Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null,bundle.ciphertext,p.encode([p.SUITE,"recovery",scope]),bundle.nonce,key));
  return p.decode(plaintext);
 } finally {key.fill(0);plaintext?.fill(0);}
}
module.exports={createRecovery,recover};
