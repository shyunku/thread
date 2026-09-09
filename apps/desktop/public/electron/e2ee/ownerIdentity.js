const {randomBytes}=require("node:crypto"),p=require("./protocol"),m=require("./membership");
const recovery=require("./recovery"),files=require("./recoveryFile");
const KEY="$owner-identity";
async function prepareOwner(store){
 const old=store.get("recovery",KEY);if(old)return publicIdentity(old);
 const scope=store.scope(),device=await p.createDevice(),authority=await p.createDevice(),deviceId=randomBytes(16).toString("hex");
 const body={schema:1,vaultId:scope.vaultId,recoveryKey:authority.signing.publicKey,
  owner:{id:deviceId,role:"write",canAuthorizeDevices:true,signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey}};
 const genesis={body,signature:await p.sign(device.signing.privateKey,"genesis",body)},fingerprint=p.fingerprint(body);
 await m.verifyGenesis(genesis,fingerprint);
 const keyring={schema:1,vaultId:scope.vaultId,genesisFingerprint:fingerprint,keyGeneration:1,keys:[{generation:1,key:randomBytes(32)}]};
 const kit=await recovery.createRecovery(scope.vaultId,fingerprint,keyring,authority.signing.privateKey);
 try{
  return store.transaction(db=>{
   const existing=db.get("recovery",KEY);if(existing)return publicIdentity(existing);
   const value={phase:"RECOVERY_UNCONFIRMED",device,deviceId,genesis,fingerprint,keyring,recoverySecret:kit.secret,recoveryBundle:kit.bundle};
   db.put("recovery",KEY,value);return publicIdentity(value);
  });
 }finally{
  for(const pair of [device.signing,device.encryption,authority.signing,authority.encryption])pair.privateKey.fill(0);
  keyring.keys[0].key.fill(0);kit.secret.fill(0);
 }
}
function publicIdentity(value){return value?{phase:value.phase,deviceId:value.deviceId,fingerprint:value.fingerprint}:null;}
function ownerStatus(store){return publicIdentity(store.get("recovery",KEY));}
function recoveryMaterial(store){
 const value=store.get("recovery",KEY);if(!value)throw Error("IDENTITY_REQUIRED");
 return {code:files.formatCode(value.recoverySecret),bytes:files.exportBundle(value.recoveryBundle),fingerprint:value.fingerprint};
}
async function confirmOwnerRecovery(store,code,bytes){
 const before=store.get("recovery",KEY);if(!before)throw Error("IDENTITY_REQUIRED");
 let restored;
 try{
  restored=await files.unlockBundle(code,bytes,{vaultId:store.scope().vaultId,genesisFingerprint:before.fingerprint});
  if(!p.encode(restored.keyring).equals(p.encode(before.keyring)))throw Error("RECOVERY_CONTENT_MISMATCH");
  await p.verify(before.genesis.body.recoveryKey,"recovery-check",before.fingerprint,
   await p.sign(restored.recoveryAuthoritySecret,"recovery-check",before.fingerprint));
  return store.transaction(db=>{
   const current=db.get("recovery",KEY);
   if(!current||!p.encode(current).equals(p.encode(before)))throw Error("IDENTITY_CHANGED");
   const next={...current,phase:"RECOVERY_CONFIRMED"};db.put("recovery",KEY,next);return publicIdentity(next);
  });
 }finally{
  restored?.recoveryAuthoritySecret?.fill(0);
  for(const item of restored?.keyring?.keys||[])item.key?.fill(0);
  before.recoverySecret.fill(0);before.device.signing.privateKey.fill(0);before.device.encryption.privateKey.fill(0);
  for(const item of before.keyring.keys)item.key.fill(0);
 }
}
module.exports={prepareOwner,ownerStatus,recoveryMaterial,confirmOwnerRecovery};
