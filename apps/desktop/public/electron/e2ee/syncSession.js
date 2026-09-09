const {historyFor}=require("./filePairing"),{validateKeys}=require("./keyTransition");
const {EncryptedReplica}=require("./replica"),{EncryptedSynchronizer}=require("./synchronize");
async function openSyncSession({store,transport,signal}){
 const ready=()=>{if(signal?.aborted)throw Error("SYNC_CANCELLED");store.scope();};
 ready();const state=await transport.accountStatus(signal);ready();
 if(state.accountMode!=="e2ee"||state.vaultMode!=="active")return {phase:"WAITING_FOR_MIGRATION"};
 if(state.vaultId!==store.scope().vaultId||typeof state.epoch!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(state.epoch))throw Error("VAULT_SCOPE_MISMATCH");
 const paired=store.get("recovery","$paired-device"),owner=store.get("recovery","$owner-identity");
 const identity=paired||(owner?.phase==="RECOVERY_CONFIRMED"?owner:null);
 if(!identity)throw Error("DEVICE_CONNECTION_REQUIRED");
 const history=await historyFor(store,{membership:after=>transport.membership(after,signal)},identity.fingerprint);ready();
 const member=history.current.devices.get(identity.deviceId);
 if(!member||!member.signingKey.equals(identity.device.signing.publicKey)||!member.encryptionKey.equals(identity.device.encryption.publicKey))throw Error("DEVICE_FORBIDDEN");
 if(history.current.revision!==state.revision||history.current.head!==state.head||history.current.keyGeneration!==state.keyGeneration)throw Error("SYNC_STATE_CHANGED");
 if(identity.keyring.vaultId!==state.vaultId||identity.keyring.genesisFingerprint!==identity.fingerprint||identity.keyring.keyGeneration!==state.keyGeneration)throw Error("KEY_REFRESH_REQUIRED");
 validateKeys(identity.keyring.keys,state.keyGeneration);
 const replica=new EncryptedReplica(store,{vaultId:state.vaultId,epoch:state.epoch,deviceId:identity.deviceId},{initialize:false});
 const keys=identity.keyring.keys,engine=new EncryptedSynchronizer({replica,history,device:identity.device,deviceId:identity.deviceId,epoch:state.epoch,transport,keyForGeneration:async generation=>{
  ready();const entry=keys.find(item=>item.generation===generation);if(!entry)throw Error("KEY_REFRESH_REQUIRED");return Buffer.from(entry.key);
 }});
 const close=()=>{
  signal?.removeEventListener("abort",close);engine.close();
  identity.device.signing.privateKey.fill(0);identity.device.encryption.privateKey.fill(0);
  for(const entry of keys)entry.key.fill(0);
 };
 signal?.addEventListener("abort",close,{once:true});
 try{
  ready();await engine.snapshot();ready();
  const latest=await transport.accountStatus(signal);ready();
  if(latest.accountMode!=="e2ee"||latest.vaultMode!=="active"||latest.vaultId!==state.vaultId||latest.epoch!==state.epoch)throw Error("SYNC_STATE_CHANGED");
  return {phase:"ACTIVE",engine,replica,close,epoch:state.epoch};
 }catch(error){close();throw error;}
}
module.exports={openSyncSession};
