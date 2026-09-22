const {randomBytes}=require("node:crypto"),p=require("./protocol"),files=require("./recoveryFile");
const {historyFor}=require("./filePairing"),{proposeTransition,validateKeys}=require("./keyTransition");
const KEY="$lost-device-recovery",same=(a,b)=>p.encode(a).equals(p.encode(b));
function empty(store){
 if(store.get("recovery","$owner-identity")||store.get("recovery","$paired-device")||store.get("confirmed","$sync-state")||store.get("recovery","$pair-current"))throw Error("FRESH_VAULT_REQUIRED");
}
function status(store){const saved=store.get("recovery",KEY);return saved?{phase:saved.phase}:null;}
function wipe(value){
 value?.recoveryAuthoritySecret?.fill(0);value?.recoverySecret?.fill(0);
 value?.device?.signing.privateKey.fill(0);value?.device?.encryption.privateKey.fill(0);
 for(const key of value?.keyring?.keys||[])key.key.fill(0);
}
async function prepare({store,transport,code,bytes,ready}){
 ready();empty(store);const previous=store.get("recovery",KEY);
 if(previous&&previous.phase!=="CANCELLED")throw Error("RECOVERY_ALREADY_PENDING");
 const parsed=p.decode(bytes),fingerprint=parsed?.bundle?.genesisFingerprint;
 let restored,device,proposal;
 try{
  restored=await files.unlockBundle(code,bytes,{vaultId:store.scope().vaultId,genesisFingerprint:fingerprint});ready();
  const ring=restored.keyring;
  if(ring?.schema!==1||ring.vaultId!==store.scope().vaultId||ring.genesisFingerprint!==fingerprint)throw Error("RECOVERY_SCOPE_MISMATCH");
  const history=await historyFor(store,transport,fingerprint);ready();
  validateKeys(ring.keys,history.current.keyGeneration);
  if(ring.keyGeneration!==history.current.keyGeneration)throw Error("RECOVERY_KIT_STALE");
  await p.verify(history.current.recoveryKey,"recovery-check",fingerprint,await p.sign(restored.recoveryAuthoritySecret,"recovery-check",fingerprint));
  const remote=await transport.accountStatus();ready();
  const active=remote.accountMode==="e2ee"&&remote.vaultMode==="active";
  const pending=(remote.accountMode==="v2"&&remote.vaultMode==="pending")||(remote.accountMode==="e2ee_frozen"&&remote.vaultMode==="migrating");
  if((!active&&!pending)||remote.vaultId!==store.scope().vaultId||
   remote.revision!==history.current.revision||remote.head!==history.current.head||remote.keyGeneration!==history.current.keyGeneration)throw Error("SYNC_STATE_CHANGED");
  device=await p.createDevice();const deviceId=randomBytes(16).toString("hex");
  proposal=await proposeTransition({state:history.current,epoch:remote.epoch,operation:"recover",recoveryAuthoritySecret:restored.recoveryAuthoritySecret,
   recipients:[{id:deviceId,role:"write",canAuthorizeDevices:true,signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey}],keys:ring.keys});
  if(pending){
   const {vaultId,revision,previous,operation,keyGeneration,recoveryKey,devices}=proposal.record.body;
   const body={vaultId,revision,previous,operation,keyGeneration,recoveryKey,devices};
   proposal.record={body,signature:await p.sign(restored.recoveryAuthoritySecret,"recovery",body)};
   await require("./membership").applyRecovery(history.current,proposal.record);
  }
  ready();store.transaction(db=>{
   empty(db);if(!same(db.get("recovery",KEY),previous))throw Error("RECOVERY_CHANGED");
   if(previous)db.put("recovery","$lost-recovery-history-"+previous.deviceId,previous);
   db.put("recovery",KEY,{phase:"RECOVERY_UNCONFIRMED",pending,device,deviceId,genesis:history.genesis,fingerprint,epoch:remote.epoch,record:proposal.record,
    keyring:proposal.keyring,recoverySecret:proposal.recovery.secret,recoveryBundle:proposal.recovery.bundle});
  });return status(store);
 }finally{wipe(restored);wipe({device});wipe(proposal);proposal?.recovery.secret.fill(0);}
}
function material(store){
 const saved=store.get("recovery",KEY);
 try{
  if(!saved||!["RECOVERY_UNCONFIRMED","RECOVERY_CONFIRMED","COMMITTING"].includes(saved.phase))throw Error("RECOVERY_NOT_PENDING");
  return {code:files.formatCode(saved.recoverySecret),bytes:files.exportBundle(saved.recoveryBundle)};
 }finally{wipe(saved);}
}
async function confirm({store,code,bytes,ready}){
 ready();const saved=store.get("recovery",KEY);let restored;
 try{
  if(!saved||!["RECOVERY_UNCONFIRMED","RECOVERY_CONFIRMED"].includes(saved.phase))throw Error("RECOVERY_NOT_PENDING");
  restored=await files.unlockBundle(code,bytes,{vaultId:store.scope().vaultId,genesisFingerprint:saved.fingerprint});ready();
  if(!same(restored.keyring,saved.keyring))throw Error("RECOVERY_CONTENT_MISMATCH");
  await p.verify(saved.record.body.recoveryKey,"recovery-check",saved.fingerprint,await p.sign(restored.recoveryAuthoritySecret,"recovery-check",saved.fingerprint));ready();
  store.transaction(db=>{empty(db);if(!same(db.get("recovery",KEY),saved))throw Error("RECOVERY_CHANGED");db.put("recovery",KEY,{...saved,phase:"RECOVERY_CONFIRMED"});});
  return status(store);
 }finally{wipe(restored);wipe(saved);}
}
async function commit({store,transport,ready}){
 ready();empty(store);const saved=store.get("recovery",KEY);
 try{
  if(!saved||!["RECOVERY_CONFIRMED","COMMITTING"].includes(saved.phase))throw Error("RECOVERY_CONFIRMATION_REQUIRED");
  let history=await historyFor(store,transport,saved.fingerprint);ready();
  const remote=await transport.accountStatus();ready();
  if(remote.vaultId!==store.scope().vaultId)throw Error("SYNC_STATE_CHANGED");
  if(!saved.pending&&(remote.accountMode!=="e2ee"||remote.vaultMode!=="active"||remote.epoch!==saved.epoch))throw Error("SYNC_STATE_CHANGED");
  if(saved.pending&&!((remote.accountMode==="v2"&&remote.vaultMode==="pending")||(remote.accountMode==="e2ee_frozen"&&remote.vaultMode==="migrating")))throw Error("SYNC_STATE_CHANGED");
  if(history.current.revision===saved.record.body.revision-1&&history.current.head===saved.record.body.previous){
   store.transaction(db=>{empty(db);if(!same(db.get("recovery",KEY),saved))throw Error("RECOVERY_CHANGED");db.put("recovery",KEY,{...saved,phase:"COMMITTING"});});
   await (saved.pending?transport.recoverPending(saved.record):transport.transition(saved.record));ready();
   history=await historyFor(store,transport,saved.fingerprint);ready();
  }
  if(history.current.revision!==saved.record.body.revision||!same(history.records.get(saved.record.body.revision),saved.record))throw Error("RECOVERY_UNCONFIRMED");
  store.transaction(db=>{
   empty(db);const current=db.get("recovery",KEY);
   if(!same(current.record,saved.record)||current.deviceId!==saved.deviceId)throw Error("RECOVERY_CHANGED");
   db.put("recovery","$owner-identity",{phase:"RECOVERY_CONFIRMED",device:saved.device,deviceId:saved.deviceId,genesis:saved.genesis,fingerprint:saved.fingerprint,
    keyring:saved.keyring,recoveryKey:saved.record.body.recoveryKey,recoverySecret:saved.recoverySecret,recoveryBundle:saved.recoveryBundle});
   db.put("recovery",KEY,{...current,phase:"ACTIVE"});
  });return status(store);
 }finally{wipe(saved);}
}
function cancel(store){
 const saved=store.get("recovery",KEY);
 try{
  if(!saved||!["RECOVERY_UNCONFIRMED","RECOVERY_CONFIRMED"].includes(saved.phase))throw Error("RECOVERY_CANCEL_UNSAFE");
  store.put("recovery",KEY,{...saved,phase:"CANCELLED"});return status(store);
 }finally{wipe(saved);}
}
module.exports={status,prepare,material,confirm,commit,cancel};
