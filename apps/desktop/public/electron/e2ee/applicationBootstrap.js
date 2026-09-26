const fs=require("node:fs"),p=require("./protocol");
const MARKER="$application-mode";
function preparationOnly(store){
 if(store.get("recovery",MARKER)||store.get("confirmed","$sync-state")||store.get("recovery","$paired-device"))return false;
 const migration=require("./applicationMigration").stateFor(store).get();
 return !migration||migration.phase==="CANCELLED";
}
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
 const locked=local.phase!=="ABSENT"&&!entry.unlocked;
 const lockedResult=async()=>{
  if(entry.abort.signal.aborted)entry.abort=new AbortController();
  const sessionSignal=entry.abort.signal,controller=new AbortController(),abort=()=>controller.abort();
  sessionSignal.addEventListener("abort",abort,{once:true});
  const timer=setTimeout(abort,2500);
  try{
   const remote=await service.transportFor(entry).accountStatus(controller.signal);check();
   return remote.accountMode==="v2"||remote.accountMode==="e2ee_frozen"?{mode:"LOCKED",migrationPending:true}:{mode:"LOCKED"};
  }catch{check();return {mode:"LOCKED"};}
  finally{clearTimeout(timer);sessionSignal.removeEventListener("abort",abort);}
 };
 if(locked){
  // A prepared vault is not an activated E2EE account. Inspect only encrypted
  // routing metadata in a short-lived read-only connection; never unlock the session.
  try{
   if(entry.applicationActive||entry.e2eeRequired||entry.vault.hasApplicationMarker())return {mode:"LOCKED"};
   if(!entry.vault.isPreparationOnly())return lockedResult();
  }catch{return {mode:"LOCKED"};} // Unreadable/unknown metadata cannot authorize v2.
  if(entry.abort.signal.aborted)entry.abort=new AbortController();
 }
 const legacy=()=>{
  check();
  if(service.busy||entry.applicationActive||entry.e2eeRequired)throw Error("APPLICATION_MODE_CHANGED");
  if(local.phase!=="ABSENT"&&!(entry.unlocked?entry.controller.use(preparationOnly):entry.vault.isPreparationOnly()))throw Error("APPLICATION_MODE_CHANGED");
  return {mode:"LEGACY"};
 };
 if(entry.migrationIntent){
  if(locked)return {mode:"LOCKED",migrationPending:true};
  return {mode:"MIGRATION_REQUIRED"};
 }
 if(entry.unlocked){
  const migration=entry.controller.use(store=>require("./applicationMigration").stateFor(store).get());
  if(migration&&!["ACTIVE","CANCELLED"].includes(migration.phase)){
   entry.migrationActive=true;return {mode:"MIGRATION_REQUIRED"};
  }
  if(migration?.phase==="ACTIVE")entry.migrationActive=false;
 }
 if(entry.unlocked&&entry.controller.use(pinnedApplication)){
  await require("./captureLegacy").capture(service,entry);check();
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
   if(caps.protocolVersion===2&&caps.mode==="v2"&&caps.enabled===true&&!entry.applicationActive&&!entry.e2eeRequired)return caps.migrationAvailable===true?{...legacy(),migrationAvailable:true}:legacy();
  }catch(error){check();if(error.message==="UPDATE_REQUIRED")return {mode:"MIGRATION_REQUIRED"};}
  const oldFile=service.group?.syncV2Service?.file(uid);
  if(!entry.applicationActive&&!entry.e2eeRequired&&!hasReplica&&oldFile&&fs.existsSync(oldFile))return legacy();
  throw Error("APPLICATION_MODE_UNAVAILABLE");
 }
 if(remote.accountMode==="e2ee_pending"){
  entry.e2eeRequired=true;
  return {mode:entry.unlocked?"NEW_ACCOUNT_SETUP":locked?"LOCKED":"NEW_ACCOUNT_SETUP"};
 }
 if(remote.accountMode==="e2ee"||remote.accountMode==="e2ee_frozen"){
  entry.e2eeRequired=true;
  if(remote.accountMode!=="e2ee"||remote.vaultMode!=="active")return {mode:"MIGRATION_REQUIRED"};
  if(!entry.unlocked)return {mode:locked?"LOCKED":"SETUP_REQUIRED"};
  const identity=entry.controller.use(store=>store.get("recovery","$paired-device")||store.get("recovery","$owner-identity"));
  if(!identity)return {mode:"SETUP_REQUIRED"};
  await require("./captureLegacy").capture(service,entry);check();
  const result=await service.syncEncrypted();check();
  if(result.phase!=="ACTIVE")throw Error("APPLICATION_MODE_UNAVAILABLE");
  return {mode:"E2EE"};
 }
 if(entry.applicationActive||entry.e2eeRequired)throw Error("APPLICATION_MODE_CHANGED");
 let caps;
 try{caps=await transport.legacyCapabilities(entry.abort.signal);check();}
 catch(error){check();if(error.message==="UPDATE_REQUIRED")return {mode:"MIGRATION_REQUIRED"};throw error;}
 if(caps.protocolVersion!==2||caps.mode!=="v2"||caps.enabled!==true)throw Error("APPLICATION_MODE_UNAVAILABLE");
 return caps.migrationAvailable===true?{...legacy(),migrationAvailable:true}:legacy();
}
async function chooseMigration(service,uid){
 if(service.busy)throw Error("VAULT_BUSY");
 if(uid!==service.runtime().getAccount())throw Error("ACCOUNT_MISMATCH");
 const entry=service.context();
 if(entry.applicationActive||entry.e2eeRequired||entry.migrationActive)throw Error("APPLICATION_MODE_CHANGED");
 const transport=service.transportFor(entry);
 const caps=await transport.legacyCapabilities(entry.abort.signal);
 if(entry!==service.active||uid!==service.runtime().getAccount())throw Error("VAULT_SESSION_CHANGED");
 if(caps.protocolVersion!==2||caps.mode!=="v2"||caps.enabled!==true||caps.migrationAvailable!==true)throw Error("MIGRATION_UNAVAILABLE");
 const legacy=service.group?.syncV2Service;
 const session=legacy?.sessions.get(uid);
 if(legacy?.opening.has(uid)||session?.running||session?.mutating)throw Error("VAULT_BUSY");
 entry.migrationActive=true;entry.migrationIntent=true;
 try{
  if(session){legacy.stop(session);await session.replica.close();legacy.sessions.delete(uid);}
  return {mode:entry.unlocked?"MIGRATION_REQUIRED":entry.vault.inspect().phase==="ABSENT"?"MIGRATION_REQUIRED":"LOCKED",migrationPending:true};
 }catch(error){entry.migrationActive=false;entry.migrationIntent=false;throw error;}
}
function leaveMigration(service,uid){
 if(uid!==service.runtime().getAccount())throw Error("ACCOUNT_MISMATCH");
 const entry=service.context();
 if(!entry.migrationIntent||service.busy)throw Error("APPLICATION_MODE_CHANGED");
 if(entry.unlocked){
  const phase=entry.controller.use(store=>require("./applicationMigration").stateFor(store).get()?.phase);
  if(phase&&phase!=="CANCELLED")throw Error("MIGRATION_IN_PROGRESS");
 }
 const local=entry.vault.inspect();
 if(local.phase!=="ABSENT"&&!(entry.unlocked?entry.controller.use(preparationOnly):entry.vault.isPreparationOnly()))throw Error("APPLICATION_MODE_CHANGED");
 entry.migrationIntent=false;entry.migrationActive=false;
 return {mode:"LEGACY"};
}
module.exports={bootstrap,chooseMigration,leaveMigration,pinApplication,pinnedApplication,selectApplication,preparationOnly};
