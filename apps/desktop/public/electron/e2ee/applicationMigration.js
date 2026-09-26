const fs=require("node:fs");
const {MigrationJournal}=require("./migrationJournal"),{MigrationSession}=require("./migrationSession"),{MigrationTransfer}=require("./migrationTransfer");
function stateFor(store){return new MigrationJournal(store,{vaultId:store.scope().vaultId});}
function status(service){
 const entry=service.context();
 return entry.controller.use(store=>({phase:stateFor(store).get()?.phase||"NOT_STARTED",busy:service.busy}));
}
async function execute(service,action,input={}){
 if(!["prepare","transfer","cancel","restart","refresh"].includes(action)||input.confirmed!==true)throw Error("MIGRATION_CONSENT_REQUIRED");
 if(service.busy)throw Error("VAULT_BUSY");
 const entry=service.context(),generation=service.generation,store=entry.controller.use(value=>value);
 // The release-gated entry screen has not opened v2. Do not race a live old
 // replica or its pending IPC writes; require a fresh entry before migrating.
 const legacy=service.group?.syncV2Service;
 if(legacy?.sessions.has(entry.uid)||legacy?.opening?.has(entry.uid))throw Error("MIGRATION_RESTART_REQUIRED");
 const check=()=>{if(service.active!==entry||service.generation!==generation||entry.abort.signal.aborted)throw Error("VAULT_SESSION_CHANGED");entry.controller.use(()=>{});};
 let session,identity;service.busy=true;
 try{
  if(input.method==="os"){
   if(!await service.runtime().osAuth.verify(service.runtime().getWindow()))throw Error("AUTH_CANCELLED");
  }else if(input.method==="password"){
   const temporary=await entry.vault.openWithPassword(input.password);temporary.close();
  }else throw Error("AUTH_REQUIRED");
  check();
  identity=store.get("recovery","$owner-identity");
  if(identity?.phase!=="RECOVERY_CONFIRMED")throw Error("RECOVERY_CONFIRMATION_REQUIRED");
  const transport=service.transportFor(entry),remote=await transport.accountStatus(entry.abort.signal);check();
  if(remote.vaultId!==store.scope().vaultId)throw Error("VAULT_SCOPE_MISMATCH");
  const history=await require("./filePairing").historyFor(store,{membership:after=>transport.membership(after,entry.abort.signal)},identity.fingerprint);check();
  const member=history.current.devices.get(identity.deviceId);
  if(!member||member.role!=="write"||!member.canAuthorizeDevices||!member.signingKey.equals(identity.device.signing.publicKey))throw Error("DEVICE_FORBIDDEN");
  if(history.current.revision!==remote.revision||history.current.head!==remote.head||history.current.keyGeneration!==remote.keyGeneration)throw Error("SYNC_STATE_CHANGED");
  require("./keyTransition").validateKeys(identity.keyring.keys,history.current.keyGeneration);
  const journal=stateFor(store);
  if(action==="prepare"&&(!journal.get()||journal.get().phase==="PREPARING")){
   const file=legacy?.file(entry.uid);
   if(file&&fs.existsSync(file)&&!store.get("recovery","$migration-local-intake")){
    const intake=await require("./legacyPending").preserveLegacyPending({filename:file,store,accountId:entry.uid});check();
    store.put("recovery","$migration-local-intake",{id:intake.id});
   }
  }
  session=new MigrationSession({store,journal,history,device:identity.device,deviceId:identity.deviceId,epoch:remote.epoch,transport});
  const abort=()=>session.close();entry.abort.signal.addEventListener("abort",abort,{once:true});
  try{
   entry.migrationActive=true;
   if(action==="prepare")await session.prepareCurrent();
   else if(action==="restart")await session.restart();
   else if(action==="refresh")await session.refreshSource();
   else if(action==="cancel")await session.cancel();
   else await new MigrationTransfer({session,keyForGeneration:async generation=>{
    check();const key=identity.keyring.keys.find(value=>value.generation===generation);
    if(!key)throw Error("KEY_REFRESH_REQUIRED");return Buffer.from(key.key);
   }}).run();
   check();const phase=journal.get().phase;
   entry.migrationActive=phase!=="CANCELLED";
   if(phase==="CANCELLED")entry.migrationIntent=false;
   return {phase};
  }finally{entry.abort.signal.removeEventListener("abort",abort);}
 }finally{
  session?.close();input.password=undefined;
  identity?.device.signing.privateKey.fill(0);identity?.device.encryption.privateKey.fill(0);identity?.recoverySecret?.fill(0);
  for(const key of identity?.keyring.keys||[])key.key.fill(0);
  service.busy=false;
 }
}
module.exports={status,execute,stateFor};
