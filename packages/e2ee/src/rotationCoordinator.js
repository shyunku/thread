const {createHash}=require("./platform"),p=require("./protocol"),files=require("./recoveryFile"),{proposeTransition}=require("./keyTransition"),{historyFor}=require("./filePairing");
const KEY="$pending-rotation",same=(a,b)=>p.encode(a).equals(p.encode(b));
const digest=value=>createHash("sha256").update(p.encode(value)).digest("hex");
function status(store){
 const value=store.get("recovery",KEY);
 return value?{phase:value.phase,revision:value.record.body.revision,removed:value.removed}:null;
}
async function prepare({store,transport,remove,ready}){
 ready();if(store.get("recovery",KEY)&&!["ACTIVE","CANCELLED"].includes(store.get("recovery",KEY).phase))throw Error("ROTATION_ALREADY_PENDING");
 const identity=store.get("recovery","$owner-identity"),meta=store.get("confirmed","$sync-state");
 if(identity?.phase!=="RECOVERY_CONFIRMED"||!meta)throw Error("ACTIVE_OWNER_REQUIRED");
 if(!Array.isArray(remove)||remove.length>31||remove.some(id=>typeof id!=="string")||new Set(remove).size!==remove.length||remove.includes(identity.deviceId))throw Error("INVALID_DEVICE_SELECTION");
 const history=await historyFor(store,transport,identity.fingerprint);ready();
 if(remove.some(id=>!history.current.devices.has(id)))throw Error("INVALID_DEVICE_SELECTION");
 const remote=await transport.accountStatus();ready();
 if(remote.accountMode!=="e2ee"||remote.epoch!==meta.scope.epoch||remote.head!==history.current.head)throw Error("SYNC_STATE_CHANGED");
 const recipients=[...history.current.devices.values()].filter(device=>!remove.includes(device.id));
 const proposal=await proposeTransition({state:history.current,epoch:meta.scope.epoch,deviceId:identity.deviceId,device:identity.device,recipients,keys:identity.keyring.keys});
 try{
  ready();store.transaction(db=>{
   if(!same(db.get("recovery","$owner-identity"),identity))throw Error("IDENTITY_CHANGED");
   const previous=db.get("recovery",KEY);
   if(previous&&!["ACTIVE","CANCELLED"].includes(previous.phase))throw Error("ROTATION_ALREADY_PENDING");
   if(previous)db.put("recovery","$rotation-history-"+previous.record.body.revision+"-"+digest(previous.record),previous);
   db.put("recovery",KEY,{phase:"RECOVERY_UNCONFIRMED",base:digest(identity),record:proposal.record,keyring:proposal.keyring,recoverySecret:proposal.recovery.secret,recoveryBundle:proposal.recovery.bundle,removed:remove});
  });return status(store);
 }finally{
  for(const key of proposal.keyring.keys)key.key.fill(0);proposal.recovery.secret.fill(0);
  identity.device.signing.privateKey.fill(0);identity.device.encryption.privateKey.fill(0);identity.recoverySecret?.fill(0);
  for(const key of identity.keyring.keys)key.key.fill(0);
 }
}
function material(store){
 const value=store.get("recovery",KEY);
 if(!value||!["RECOVERY_UNCONFIRMED","RECOVERY_CONFIRMED","COMMITTING"].includes(value.phase))throw Error("ROTATION_NOT_PENDING");
 return {code:files.formatCode(value.recoverySecret),bytes:files.exportBundle(value.recoveryBundle)};
}
async function confirm({store,code,bytes,ready}){
 ready();const before=store.get("recovery",KEY);
 if(!before||!["RECOVERY_UNCONFIRMED","RECOVERY_CONFIRMED"].includes(before.phase))throw Error("ROTATION_NOT_PENDING");
 let restored;
 try{
  restored=await files.unlockBundle(code,bytes,{vaultId:store.scope().vaultId,genesisFingerprint:before.keyring.genesisFingerprint});ready();
  if(!same(restored.keyring,before.keyring))throw Error("RECOVERY_CONTENT_MISMATCH");
  await p.verify(before.record.body.recoveryKey,"recovery-check",before.keyring.genesisFingerprint,await p.sign(restored.recoveryAuthoritySecret,"recovery-check",before.keyring.genesisFingerprint));ready();
  store.transaction(db=>{if(!same(db.get("recovery",KEY),before))throw Error("ROTATION_CHANGED");db.put("recovery",KEY,{...before,phase:"RECOVERY_CONFIRMED"});});
  return status(store);
 }finally{restored?.recoveryAuthoritySecret?.fill(0);for(const key of restored?.keyring.keys||[])key.key.fill(0);}
}
async function commit({store,transport,ready}){
 ready();const proposal=store.get("recovery",KEY),identity=store.get("recovery","$owner-identity");
 if(!proposal||!["RECOVERY_CONFIRMED","COMMITTING"].includes(proposal.phase))throw Error("RECOVERY_CONFIRMATION_REQUIRED");
 if(proposal.base!==digest(identity))throw Error("IDENTITY_CHANGED");
 let history=await historyFor(store,transport,identity.fingerprint);ready();
 if(history.current.revision===proposal.record.body.revision-1&&history.current.head===proposal.record.body.previous){
  store.transaction(db=>{if(!same(db.get("recovery",KEY),proposal))throw Error("ROTATION_CHANGED");db.put("recovery",KEY,{...proposal,phase:"COMMITTING"});});
  await transport.transition(proposal.record);ready();
  history=await historyFor(store,transport,identity.fingerprint);ready();
 }
 if(history.current.revision!==proposal.record.body.revision||!same(history.records.get(proposal.record.body.revision),proposal.record))throw Error("ROTATION_UNCONFIRMED");
 store.transaction(db=>{
  const current=db.get("recovery",KEY);
  if(!same(current.record,proposal.record)||current.base!==proposal.base||digest(db.get("recovery","$owner-identity"))!==proposal.base)throw Error("IDENTITY_CHANGED");
  db.put("recovery","$owner-identity",{...identity,recoveryStale:false,keyring:proposal.keyring,recoveryKey:proposal.record.body.recoveryKey,recoverySecret:proposal.recoverySecret,recoveryBundle:proposal.recoveryBundle});
  db.put("recovery",KEY,{...current,phase:"ACTIVE"});
 });return status(store);
}
function cancel(store){
 const value=store.get("recovery",KEY);
 if(!value||!["RECOVERY_UNCONFIRMED","RECOVERY_CONFIRMED"].includes(value.phase))throw Error("ROTATION_CANCEL_UNSAFE");
 store.put("recovery",KEY,{...value,phase:"CANCELLED"});return status(store);
}
module.exports={status,prepare,material,confirm,commit,cancel};
