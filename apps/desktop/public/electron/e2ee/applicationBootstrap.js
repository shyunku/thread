const fs=require("node:fs"),p=require("./protocol");
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
 const old=service.group?.syncV2Service?.sessions.get(entry.uid);
 if(old)service.group.syncV2Service.stop(old);
 if(!entry.poller){
  entry.poller=setInterval(()=>{
   if(service.active===entry&&entry.unlocked&&!service.busy)void service.syncEncrypted().catch(()=>{});
  },15000);
  entry.poller.unref?.();
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
 if(local.phase!=="ABSENT"&&!entry.unlocked)return {mode:"LOCKED"};
 if(entry.unlocked&&entry.controller.use(pinnedApplication)){
  selectApplication(service,entry);return {mode:"E2EE"};
 }
 const hasReplica=entry.unlocked&&entry.controller.use(store=>!!store.get("confirmed","$sync-state"));
 if(hasReplica)entry.e2eeRequired=true;
 const transport=service.transportFor(entry);
 let remote;
 try{remote=await transport.accountStatus(entry.abort.signal);check();}
 catch(error){
  check();
  // A failed v3 probe does not by itself authorize plaintext networking.
  // The existing v2 server must positively confirm the old account mode.
  try{
   const caps=await transport.legacyCapabilities(entry.abort.signal);check();
   if(caps.protocolVersion===2&&caps.mode==="v2"&&caps.enabled===true&&!entry.applicationActive&&!entry.e2eeRequired)return {mode:"LEGACY"};
  }catch(error){check();if(error.message==="UPDATE_REQUIRED")return {mode:"MIGRATION_REQUIRED"};}
  const oldFile=service.group?.syncV2Service?.file(uid);
  if(!entry.applicationActive&&!entry.e2eeRequired&&!hasReplica&&oldFile&&fs.existsSync(oldFile))return {mode:"LEGACY"};
  throw Error("APPLICATION_MODE_UNAVAILABLE");
 }
 if(remote.accountMode==="e2ee"||remote.accountMode==="e2ee_frozen"){
  entry.e2eeRequired=true;
  if(remote.accountMode!=="e2ee"||remote.vaultMode!=="active")return {mode:"MIGRATION_REQUIRED"};
  if(!entry.unlocked)return {mode:"SETUP_REQUIRED"};
  const identity=entry.controller.use(store=>store.get("recovery","$paired-device")||store.get("recovery","$owner-identity"));
  if(!identity)return {mode:"SETUP_REQUIRED"};
  const result=await service.syncEncrypted();check();
  if(result.phase!=="ACTIVE")throw Error("APPLICATION_MODE_UNAVAILABLE");
  return {mode:"E2EE"};
 }
 if(entry.applicationActive||entry.e2eeRequired)throw Error("APPLICATION_MODE_CHANGED");
 let caps;
 try{caps=await transport.legacyCapabilities(entry.abort.signal);check();}
 catch(error){check();if(error.message==="UPDATE_REQUIRED")return {mode:"MIGRATION_REQUIRED"};throw error;}
 if(caps.protocolVersion!==2||caps.mode!=="v2"||caps.enabled!==true)throw Error("APPLICATION_MODE_UNAVAILABLE");
 return {mode:"LEGACY"};
}
module.exports={bootstrap,pinApplication,pinnedApplication,selectApplication};
