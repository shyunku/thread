const {ApplicationAdapter,mutationTopics}=require("./applicationAdapter");
const reads={"task/getAllTaskList":"tasks","task/getAllSubtaskList":"subtasks","category/getCategoryList":"categories","tasks_categories/getTasksCategoriesList":"relations"};
const blocked=new Set(["auth/initializeDatabase","system/migrateLegacyDatabase","system/truncateLegacyDatabase","system/mismatchTxAcceptTheirs","system/mismatchTxAcceptMine","system/initializeState","system/clearStatePermanently"]);
const passive=new Set(["auth/isDatabaseReady","system/isLegacyMigrationAvailable","system/localLastBlockNumber","system/remoteLastBlockNumber","system/migrateCheckDoneSignal","system/lastTxUpdateTime"]);
async function intercept(service,topic,reqId,args){
 const entry=service.active,ipc=service.group?.ipcService;
 if(entry?.migrationActive&&entry.uid===service.runtime().getAccount()&&ipc&&
  (mutationTopics.has(topic)||reads[topic]||blocked.has(topic)||passive.has(topic)||/^(task|category|tasks_categories|sync-v2|socket)\//.test(topic)||["system/stateListenReady","system/isDatabaseClear"].includes(topic))){
  ipc.sender(topic,reqId,false,{code:"MIGRATION_IN_PROGRESS"});return true;
 }
 if(!entry?.applicationActive||entry.uid!==service.runtime().getAccount()||!ipc)return false;
 const supported=mutationTopics.has(topic)||reads[topic]||blocked.has(topic)||passive.has(topic)||["socket/connect","socket/disconnect","category/getCategoryTasks","system/isDatabaseClear","system/stateListenReady","sync-v2/getStatus","sync-v2/retry"].includes(topic);
 const handled=supported||/^(task|category|tasks_categories)\//.test(topic);
 if(!handled)return false;
 try{
  if(!supported)throw Error("UNSUPPORTED_APPLICATION_ACTION");
  if(blocked.has(topic))throw Error("E2EE_LEGACY_ACTION_BLOCKED");
  if(topic==="auth/isDatabaseReady"&&args[0]!==entry.uid)throw Error("ACCOUNT_MISMATCH");
  if(topic==="socket/connect"){await service.syncEncrypted();ipc.sender(topic,reqId,true);return true;}
  if(topic==="socket/disconnect"){service.lock();ipc.sender(topic,reqId,true);return true;}
  if(service.busy&&mutationTopics.has(topic))throw Error("VAULT_BUSY");
  if(topic==="sync-v2/retry"){await service.syncEncrypted();ipc.sender(topic,reqId,true,{ready:true});return true;}
  const result=entry.controller.use(store=>{
   const {EncryptedReplica}=require("./replica"),meta=store.get("confirmed","$sync-state");
   if(!meta)throw Error("SYNC_REQUIRED");
   const replica=new EncryptedReplica(store,meta.scope,{initialize:false}),adapter=new ApplicationAdapter(replica);
   if(mutationTopics.has(topic))return {syncV2Ack:true,clientChangeId:adapter.mutate(topic,args)};
   if(passive.has(topic))return ["auth/isDatabaseReady","system/migrateCheckDoneSignal"].includes(topic)?true:0;
   if(reads[topic])return adapter.lists()[reads[topic]];
   if(topic==="category/getCategoryTasks")return adapter.lists().relations.filter(row=>row.cid===args[0]);
   if(topic==="system/isDatabaseClear")return adapter.lists().tasks.length===0;
   if(topic==="sync-v2/getStatus")return statusOf(entry,replica.status());
   return true;
  });
  publish(service,entry);ipc.sender(topic,reqId,true,result);
  if(mutationTopics.has(topic))void service.syncEncrypted().catch(()=>{});
 }catch(error){ipc.sender(topic,reqId,false,{syncV2Ack:mutationTopics.has(topic),code:error.message});}
 return true;
}
function statusOf(entry,status){
 return {uid:entry.uid,protocolVersion:3,ready:true,connected:!!entry.connected,syncing:!!entry.syncing,canSync:true,seq:status.cursor,pending:status.pending,recovery:status.conflicts,lastSyncedAt:entry.lastSyncedAt??null,error:null};
}
function replicaStatus(entry){
 return entry.controller.use(store=>{
  const {EncryptedReplica}=require("./replica"),meta=store.get("confirmed","$sync-state");
  return meta?new EncryptedReplica(store,meta.scope,{initialize:false}).status():null;
 });
}
// Status only (no task lists): sent when a sync starts and when it ends without new data.
// Display-only, so a failure here must never break the sync that called it.
function publishStatus(service,entry){
 if(service.active!==entry||!entry.applicationActive||entry.uid!==service.runtime().getAccount())return;
 try{
  const status=replicaStatus(entry);
  if(status)service.group?.ipcService.sender("sync-v2/status",null,true,statusOf(entry,status));
 }catch{}
}
function publish(service,entry){
 if(service.active!==entry||entry.uid!==service.runtime().getAccount())return;
 const lists=entry.controller.use(store=>{
  const {EncryptedReplica}=require("./replica"),meta=store.get("confirmed","$sync-state");
  return new ApplicationAdapter(new EncryptedReplica(store,meta.scope,{initialize:false})).lists();
 });
 service.group?.ipcService.sender("sync-v2/state",null,true,{uid:entry.uid,...lists});
 const status=entry.controller.use(store=>{
  const {EncryptedReplica}=require("./replica"),meta=store.get("confirmed","$sync-state");
  return new EncryptedReplica(store,meta.scope,{initialize:false}).status();
 });
 service.group?.ipcService.sender("sync-v2/status",null,true,statusOf(entry,status));
}
module.exports={intercept,publish,publishStatus};
