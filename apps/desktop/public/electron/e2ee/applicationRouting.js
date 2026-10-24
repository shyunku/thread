const {ApplicationAdapter,mutationTopics:single,compositeTopics}=require("./applicationAdapter");
// Composite topics (duplicate, delete a category in use) are mutations too.
const mutationTopics={has:topic=>single.has(topic)||compositeTopics.has(topic)};
const reads={"task/getAllTaskList":"tasks","task/getAllSubtaskList":"subtasks","category/getCategoryList":"categories","tasks_categories/getTasksCategoriesList":"relations"};
const blocked=new Set(["auth/initializeDatabase","system/migrateLegacyDatabase","system/truncateLegacyDatabase","system/mismatchTxAcceptTheirs","system/mismatchTxAcceptMine","system/initializeState","system/clearStatePermanently"]);
const passive=new Set(["auth/isDatabaseReady","system/isLegacyMigrationAvailable","system/localLastBlockNumber","system/remoteLastBlockNumber","system/migrateCheckDoneSignal","system/lastTxUpdateTime"]);
// A mutation that arrives while a vault action holds the vault (a sync, a user check, pairing)
// waits for it, up to MUTATION_WAIT ms, and then applies in arrival order. The sync engine signs,
// pushes and settles outbox drafts across awaits, so a change must never land inside a run. Nothing
// that holds the vault waits for a mutation, so the wait cannot deadlock; a queued change is applied
// synchronously and the queue starts one sync after it drains.
const MUTATION_WAIT=10000,MUTATION_POLL=25;
function queueMutation(service,run){
 const queue=service.mutationQueue||(service.mutationQueue=[]);
 return new Promise((resolve,reject)=>{queue.push({run,resolve,reject,until:Date.now()+(service.mutationWait??MUTATION_WAIT)});scheduleDrain(service);});
}
function scheduleDrain(service){
 if(!service.mutationTimer)service.mutationTimer=setTimeout(()=>{service.mutationTimer=null;drainMutations(service);},MUTATION_POLL);
}
function drainMutations(service){
 const queue=service.mutationQueue||[];let applied=false;
 while(queue.length&&!service.busy){const item=queue.shift();try{item.run();applied=true;item.resolve();}catch(error){item.reject(error);}}
 // Same wait for every item, so the oldest expires first.
 for(const now=Date.now();queue.length&&queue[0].until<=now;)queue.shift().reject(Error("VAULT_BUSY"));
 if(applied&&!service.busy)void service.syncEncrypted().catch(()=>{});
 if(queue.length)scheduleDrain(service);
}
// Applies one mutation and answers it; throws when it cannot (the caller answers the error).
function applyMutation(service,entry,topic,reqId,args){
 if(service.active!==entry||entry.uid!==service.runtime().getAccount())throw Error("VAULT_SESSION_CHANGED");
 if(entry.migrationActive)throw Error("MIGRATION_IN_PROGRESS");
 if(!entry.applicationActive)throw Error("VAULT_SESSION_CHANGED");
 const result=entry.controller.use(store=>{
  const {EncryptedReplica}=require("./replica"),meta=store.get("confirmed","$sync-state");
  if(!meta)throw Error("SYNC_REQUIRED");
  return {syncV2Ack:true,clientChangeId:new ApplicationAdapter(new EncryptedReplica(store,meta.scope,{initialize:false})).mutate(topic,args)};
 });
 publish(service,entry);
 service.group?.ipcService.sender(topic,reqId,true,result);
}
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
  if(mutationTopics.has(topic)){
   const run=()=>applyMutation(service,entry,topic,reqId,args);
   if(service.busy||service.mutationQueue?.length)await queueMutation(service,run);
   else{run();void service.syncEncrypted().catch(()=>{});}
   return true;
  }
  if(topic==="sync-v2/retry"){await service.syncEncrypted();ipc.sender(topic,reqId,true,{ready:true});return true;}
  const result=entry.controller.use(store=>{
   const {EncryptedReplica}=require("./replica"),meta=store.get("confirmed","$sync-state");
   if(!meta)throw Error("SYNC_REQUIRED");
   const replica=new EncryptedReplica(store,meta.scope,{initialize:false}),adapter=new ApplicationAdapter(replica);
   if(passive.has(topic))return ["auth/isDatabaseReady","system/migrateCheckDoneSignal"].includes(topic)?true:0;
   if(reads[topic])return adapter.lists()[reads[topic]];
   if(topic==="category/getCategoryTasks")return adapter.lists().relations.filter(row=>row.cid===args[0]);
   if(topic==="system/isDatabaseClear")return adapter.lists().tasks.length===0;
   if(topic==="sync-v2/getStatus")return statusOf(entry,replica.status());
   return true;
  });
  // Only a change (or the window asking for its state) sends the lists; reads already
  // return their data, and sending the whole list after every request was most of the
  // startup cost with many tasks (#98).
  if(topic==="system/stateListenReady")publish(service,entry,{force:true});
  ipc.sender(topic,reqId,true,result);
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
// Sends the lists only when the visible objects changed since the last send to this
// window (store write counter), or when forced (the window (re)loaded and asks for them).
function publish(service,entry,{force=false}={}){
 if(service.active!==entry||entry.uid!==service.runtime().getAccount())return;
 const next=entry.controller.use(store=>{
  const revision=typeof store.revision==="function"?store.revision("visible"):null;
  if(!force&&revision!==null&&entry.published?.store===store&&entry.published.revision===revision)return null;
  const {EncryptedReplica}=require("./replica"),meta=store.get("confirmed","$sync-state");
  return {store,revision,lists:new ApplicationAdapter(new EncryptedReplica(store,meta.scope,{initialize:false})).lists()};
 });
 if(next){
  service.group?.ipcService.sender("sync-v2/state",null,true,{uid:entry.uid,...next.lists});
  // Due reminders (#91) follow the lists while the vault is open.
  service.group?.remindersService?.update(next.lists);
  entry.published={store:next.store,revision:next.revision};
 }
 const status=entry.controller.use(store=>{
  const {EncryptedReplica}=require("./replica"),meta=store.get("confirmed","$sync-state");
  return new EncryptedReplica(store,meta.scope,{initialize:false}).status();
 });
 service.group?.ipcService.sender("sync-v2/status",null,true,statusOf(entry,status));
}
module.exports={intercept,publish,publishStatus};
