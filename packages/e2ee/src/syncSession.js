const {historyFor}=require("./filePairing"),{validateKeys}=require("./keyTransition");
const {EncryptedReplica}=require("./replica"),{EncryptedSynchronizer}=require("./synchronize");
const {refreshSessionKeys}=require("./sessionKeys");
// migrationJournalFor(store): desktop-only migration journal (null elsewhere).
async function openSyncSession({store,transport,signal,migrationJournalFor=null}){
 if(store.get("recovery","$pending-rotation")?.phase==="COMMITTING")throw Error("ROTATION_RECONCILE_REQUIRED");
 const ready=()=>{if(signal?.aborted)throw Error("SYNC_CANCELLED");store.scope();};
 ready();const state=await transport.accountStatus(signal);ready();
 if(state.accountMode!=="e2ee"||state.vaultMode!=="active")return {phase:"WAITING_FOR_MIGRATION"};
 if(state.vaultId!==store.scope().vaultId||typeof state.epoch!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(state.epoch))throw Error("VAULT_SCOPE_MISMATCH");
 const paired=store.get("recovery","$paired-device"),owner=store.get("recovery","$owner-identity");
 const identity=paired||(owner?.phase==="RECOVERY_CONFIRMED"?owner:null);
 const identityKey=paired?"$paired-device":"$owner-identity";
 if(!identity)throw Error("DEVICE_CONNECTION_REQUIRED");
 const history=await historyFor(store,{membership:after=>transport.membership(after,signal)},identity.fingerprint);ready();
 const member=history.current.devices.get(identity.deviceId);
 if(!member||!member.signingKey.equals(identity.device.signing.publicKey)||!member.encryptionKey.equals(identity.device.encryption.publicKey))throw Error("DEVICE_FORBIDDEN");
 if(history.current.revision!==state.revision||history.current.head!==state.head||history.current.keyGeneration!==state.keyGeneration)throw Error("SYNC_STATE_CHANGED");
 const refreshKeys=history=>refreshSessionKeys({store,identityKey,identity,history,epoch:state.epoch,ready});
 await refreshKeys(history);ready();
 validateKeys(identity.keyring.keys,state.keyGeneration);
 const replica=new EncryptedReplica(store,{vaultId:state.vaultId,epoch:state.epoch,deviceId:identity.deviceId},{initialize:false});
 const engine=new EncryptedSynchronizer({replica,history,device:identity.device,deviceId:identity.deviceId,epoch:state.epoch,transport,refreshKeys,keyForGeneration:async generation=>{
  ready();const entry=identity.keyring.keys.find(item=>item.generation===generation);if(!entry)throw Error("KEY_REFRESH_REQUIRED");return Buffer.from(entry.key);
 }});
 const close=()=>{
  signal?.removeEventListener("abort",close);engine.close();
  identity.device.signing.privateKey.fill(0);identity.device.encryption.privateKey.fill(0);
  for(const entry of identity.keyring.keys)entry.key.fill(0);
 };
 signal?.addEventListener("abort",close,{once:true});
 try{
  const journal=migrationJournalFor?.(store)??null,migration=journal?.get();
  // The journal stays ACTIVE after a migration; once the migrated snapshot has been
  // installed locally (READY mark) the replica syncs like any other (#98.5).
  const migrating=migration&&migration.phase!=="CANCELLED"&&
   !(migration.phase==="ACTIVE"&&store.get("recovery","$migration-local-"+migration.id)?.phase==="READY");
  // A replica that already synced pulls only the changes since its cursor and then
  // compares its objects with the server's state digest; a first sync, a migration
  // or a mismatch restores from a full snapshot (#98).
  const meta=store.get("confirmed","$sync-state");
  let restored=false;
  if(!migrating&&meta&&meta.cursor!=="0"){
   ready();await engine.refreshMembership();await engine.pull();ready();
   restored=(await engine.verifyState())!==false;ready();
  }
  if(!restored){ready();await engine.snapshot(migrating?journal:null);ready();}
  const latest=await transport.accountStatus(signal);ready();
  if(latest.accountMode!=="e2ee"||latest.vaultMode!=="active"||latest.vaultId!==state.vaultId||latest.epoch!==state.epoch)throw Error("SYNC_STATE_CHANGED");
  return {phase:"ACTIVE",engine,replica,close,epoch:state.epoch};
 }catch(error){close();throw error;}
}
module.exports={openSyncSession};
