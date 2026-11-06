const p=require("./protocol");
const MARKER="$application-mode";
function pinApplication(store){
 const meta=store.get("confirmed","$sync-state");
 if(!meta)throw Error("SYNC_REQUIRED");
 store.transaction(db=>{
  const marker={schema:1,scope:meta.scope},old=db.get("recovery",MARKER);
  if(old&&!p.encode(old).equals(p.encode(marker)))throw Error("APPLICATION_MODE_CHANGED");
  db.put("recovery",MARKER,marker);
 });
}
function pinnedApplication(store){
 const marker=store.get("recovery",MARKER);if(!marker)return false;
 const meta=store.get("confirmed","$sync-state");
 if(marker.schema!==1||!meta||marker.scope.vaultId!==store.scope().vaultId||!p.encode(marker.scope).equals(p.encode(meta.scope)))throw Error("APPLICATION_MODE_CHANGED");
 return true;
}
function selectApplication(service,entry){
 entry.applicationActive=true;
 if(!entry.poller){
  entry.poller=setInterval(()=>{
   if(service.active===entry&&entry.unlocked&&!service.busy)void service.syncEncrypted().catch(()=>{});
  },15000);
  entry.poller.unref?.();
 }
 // Server signals arrive within a second; the poller above stays as a fallback.
 if(!entry.events&&!service.runtime().transport){
  try{
   service.transportFor(entry);
   const {startSyncEvents,syncScheduler}=require("./syncEvents");
   const schedule=syncScheduler(()=>service.active===entry&&entry.unlocked?service.syncEncrypted():null);
   entry.events=startSyncEvents({endpoint:service.registrationEndpoint(),tokens:entry.tokenSession,signal:entry.abort.signal,
    fetch:service.runtime().fetch||globalThis.fetch,onChange:schedule});
  }catch{entry.events=null;}
 }
}
async function bootstrap(service,uid){
 if(service.busy)throw Error("VAULT_BUSY");
 if(typeof uid!=="string"||!uid||uid.length>256)throw Error("AUTH_REQUIRED");
 service.group?.userService.setCurrent(uid);
 if(service.runtime().getAccount()!==uid)throw Error("ACCOUNT_MISMATCH");
 const entry=service.context(),generation=service.generation;
 const check=()=>{if(entry!==service.active||uid!==service.runtime().getAccount()||generation!==service.generation)throw Error("VAULT_SESSION_CHANGED");};
 const local=entry.vault.inspect();
 if(local.phase==="RECOVERY_REQUIRED")return {mode:"RECOVERY_REQUIRED"};
 // A locked vault never unlocks here; unlocking asks again.
 if(local.phase!=="ABSENT"&&!entry.unlocked)return {mode:"LOCKED"};
 if(entry.unlocked&&entry.controller.use(pinnedApplication)){
  selectApplication(service,entry);return {mode:"E2EE"};
 }
 const hasReplica=entry.unlocked&&entry.controller.use(store=>!!store.get("confirmed","$sync-state"));
 if(hasReplica)entry.e2eeRequired=true;
 let remote;
 try{remote=await service.transportFor(entry).accountStatus(entry.abort.signal);check();}
 catch{check();throw Error("APPLICATION_MODE_UNAVAILABLE");}
 if(remote.accountMode==="e2ee_pending"){
  entry.e2eeRequired=true;
  return {mode:"NEW_ACCOUNT_SETUP"};
 }
 if(remote.accountMode==="e2ee"&&remote.vaultMode==="active"){
  entry.e2eeRequired=true;
  if(!entry.unlocked)return {mode:"SETUP_REQUIRED"};
  const identity=entry.controller.use(store=>store.get("recovery","$paired-device")||store.get("recovery","$owner-identity"));
  if(!identity)return {mode:"SETUP_REQUIRED"};
  const result=await service.syncEncrypted();check();
  if(result.phase!=="ACTIVE")throw Error("APPLICATION_MODE_UNAVAILABLE");
  return {mode:"E2EE"};
 }
 if(entry.applicationActive||entry.e2eeRequired)throw Error("APPLICATION_MODE_CHANGED");
 throw Error("APPLICATION_MODE_UNAVAILABLE");
}
module.exports={bootstrap,pinApplication,pinnedApplication,selectApplication};
