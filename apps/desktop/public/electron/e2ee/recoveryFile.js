const {createHash,timingSafeEqual}=require("node:crypto");
const p=require("./protocol"),recovery=require("./recovery");
function checksum(secret){return createHash("sha256").update("thread-recovery-code-v1").update(secret).digest().subarray(0,4);}
function formatCode(secret){
 if(!Buffer.isBuffer(secret)||secret.length!==32)throw Error("INVALID_RECOVERY_CODE");
 return "THREAD1-"+Buffer.concat([secret,checksum(secret)]).toString("hex").toUpperCase().match(/.{8}/g).join("-");
}
function parseCode(code){
 if(typeof code!=="string"||code.length>128)throw Error("INVALID_RECOVERY_CODE");
 const value=code.trim().toUpperCase();if(!/^THREAD1-(?:[0-9A-F]{8}-){8}[0-9A-F]{8}$/.test(value))throw Error("INVALID_RECOVERY_CODE");
 const bytes=Buffer.from(value.slice(8).replace(/-/g,""),"hex");
 try{if(bytes.length!==36||!timingSafeEqual(checksum(bytes.subarray(0,32)),bytes.subarray(32)))throw Error("RECOVERY_CODE_CHECKSUM");return Buffer.from(bytes.subarray(0,32));}
 finally{bytes.fill(0);}
}
function validateBundle(b){
 if(!b||Object.keys(b).length!==5||b.schema!==1||typeof b.vaultId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(b.vaultId)||typeof b.genesisFingerprint!=="string"||!/^[a-f0-9]{64}$/.test(b.genesisFingerprint)||!Buffer.isBuffer(b.nonce)||b.nonce.length!==24||!Buffer.isBuffer(b.ciphertext)||b.ciphertext.length<16)throw Error("INVALID_RECOVERY_FILE");return b;
}
function exportBundle(bundle){return p.encode({schema:1,kind:"recovery-bundle",bundle:validateBundle(bundle)});}
function importBundle(bytes,scope){
 const f=p.decode(bytes);if(!f||Object.keys(f).length!==3||f.schema!==1||f.kind!=="recovery-bundle")throw Error("INVALID_RECOVERY_FILE");
 const b=validateBundle(f.bundle);if(b.vaultId!==scope.vaultId||b.genesisFingerprint!==scope.genesisFingerprint)throw Error("RECOVERY_SCOPE_MISMATCH");return b;
}
async function unlockBundle(code,bytes,scope){const secret=parseCode(code);try{return await recovery.recover(secret,importBundle(bytes,scope),scope);}finally{secret.fill(0);}}
module.exports={formatCode,parseCode,exportBundle,importBundle,unlockBundle};
