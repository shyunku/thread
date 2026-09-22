const p=require("./protocol"),{createHash}=require("node:crypto");
function collect(replica){
 const pending=replica.pending(),objects=new Map(),hash=createHash("sha256"),store=replica.store;
 const meta=store.get("confirmed","$sync-state"),authority=store.get("recovery","$last-sync-authority");
 hash.update(p.encode(meta));hash.update(p.encode(authority));
 let retired=true;
 for(const row of pending){
  hash.update(p.encode(row));
  if(row.value.record){
   const signed=p.decode(row.value.record).body;
   if(!authority||!Number.isSafeInteger(authority.keyGeneration)||authority.keyGeneration<1||
     !Number.isSafeInteger(signed.keyGeneration)||signed.keyGeneration<1||authority.epoch!==replica.scope.epoch||authority.cursor!==meta.cursor||
     signed.epoch!==replica.scope.epoch||signed.deviceId!==replica.scope.deviceId||signed.keyGeneration>=authority.keyGeneration)retired=false;
  }
  for(const local of row.value.changes)objects.set(local.objectId,{local,current:store.get("confirmed",local.objectId)});
 }
 for(const [id,value] of [...objects].sort(([a],[b])=>a<b?-1:1)){hash.update(p.encode([id,value.current]));}
 return {pending,objects,retired,revision:hash.digest("hex")};
}
const preview=value=>{const text=JSON.stringify(value?.fields??null);return {deleted:value?.deleted??false,missing:!value,text:text.slice(0,2000),truncated:text.length>2000};};
function review(replica){
 const state=collect(replica),tooLarge=state.objects.size>100;
 return {revision:state.revision,requests:state.pending.length,objects:state.objects.size,canResolve:state.pending.length>0&&!tooLarge&&state.retired,
  reason:tooLarge?"GROUP_LIMIT":!state.retired?"ROTATION_AND_SYNC_REQUIRED":null,
  items:[...state.objects].slice(0,100).map(([id,value])=>({id,local:preview(value.local),current:preview(value.current)}))};
}
function validateApplication(store){
 const {ApplicationAdapter}=require("./applicationAdapter"),{EncryptedReplica}=require("./replica"),meta=store.get("confirmed","$sync-state");
 const lists=new ApplicationAdapter(new EncryptedReplica(store,meta.scope,{initialize:false})).lists();
 const tasks=new Set(lists.tasks.map(row=>row.tid)),categories=new Set(lists.categories.map(row=>row.cid));
 if(lists.subtasks.some(row=>!tasks.has(row.tid))||lists.relations.some(row=>!tasks.has(row.tid)||!categories.has(row.cid)))throw Error("DEPENDENCY_REVIEW_REQUIRED");
}
function resolve(replica,{expectedRevision,choice,confirmed}={}){
 if(confirmed!==true||typeof expectedRevision!=="string"||!/^[a-f0-9]{64}$/.test(expectedRevision)||!["local","current"].includes(choice))throw Error("INVALID_GROUP_RESOLUTION");
 return replica.store.transaction(db=>{
  const name="$resolved-group-"+expectedRevision,prior=db.get("recovery",name);
  if(prior){if(prior.choice!==choice)throw Error("RESOLUTION_CHANGED");return prior.result;}
  const state=collect(replica);
  if(state.revision!==expectedRevision)throw Error("REVIEW_CHANGED");
  if(!state.pending.length||state.objects.size>100)throw Error("GROUP_LIMIT");
  if(!state.retired)throw Error("ROTATION_AND_SYNC_REQUIRED");
  for(const row of state.pending){db.put("recovery",name+"-"+row.id,row.value);db.delete("outbox",row.id);}
  const changes=[];
  for(const [id,{local,current}] of state.objects){
   if(current)db.put("visible",id,{...current,pending:false});else db.delete("visible",id);
   if(choice==="local"&&!(local.deleted&&(!current||current.deleted)))changes.push({...local,baseVersion:current?.version??"0"});
  }
  const newId=changes.length?replica.enqueue(changes):null;
  validateApplication(db);
  const result={phase:newId?"QUEUED":"CURRENT_SELECTED",newId,archived:state.pending.length};
  db.put("recovery",name,{choice,result});return result;
 });
}
module.exports={review,resolve,validateApplication};
