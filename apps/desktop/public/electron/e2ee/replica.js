const {randomBytes}=require("node:crypto");
const p=require("./protocol"),sync=require("./syncProtocol");
const {SnapshotVerifier}=require("./readProtocol");
const META="$sync-state";
function rows(store,bucket){const all=[];let after="";for(;;){const page=store.entries(bucket,after,256);all.push(...page);if(page.length<256)return all;after=page[page.length-1].id;}}
function overlay(change){return {...change,version:(sync.decimal(change.baseVersion)+1n).toString(),pending:true};}
class EncryptedReplica {
 constructor(store,scope){
  this.store=store;
  if(!scope||Object.keys(scope).length!==3||!["vaultId","epoch","deviceId"].every(k=>typeof scope[k]==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(scope[k])))throw Error("INVALID_REPLICA_SCOPE");
  this.scope=p.decode(p.encode(scope));
  store.transaction(db=>{const meta=db.get("confirmed",META);if(meta){if(!p.encode(meta.scope).equals(p.encode(scope)))throw Error("REPLICA_SCOPE_MISMATCH");}else db.put("confirmed",META,{scope:this.scope,cursor:"0",counter:"0",deviceCounters:[]});});
 }
 pending(){const all=rows(this.store,"outbox");if(all.length>10000)throw Error("OUTBOX_LIMIT");return all.sort((a,b)=>sync.decimal(a.value.counter)<sync.decimal(b.value.counter)?-1:1);}
 status(){const meta=this.store.get("confirmed",META),pending=this.pending();return {cursor:meta.cursor,pending:pending.length,conflicts:pending.filter(row=>row.value.status==="conflict").length};}
 enqueue(changes){
  const id=randomBytes(16).toString("hex");this.store.transaction(db=>{
   if(!Array.isArray(changes)||changes.length<1||changes.length>100)throw Error("INVALID_DRAFT");
   const pending=this.pending(),ids=new Set(),bases=[];
   if(pending.length>=10000)throw Error("OUTBOX_LIMIT");
   for(const c of changes){if(!c||typeof c.objectId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(c.objectId)||ids.has(c.objectId))throw Error("INVALID_DRAFT");ids.add(c.objectId);
    sync.decimal(c.baseVersion);if(sync.decimal(c.baseVersion)===18446744073709551615n)throw Error("VERSION_LIMIT");
    if(typeof c.deleted!=="boolean"||!Array.isArray(c.fields)||c.fields.length>256||(c.deleted?c.fields.length!==0:c.fields.length===0))throw Error("INVALID_DRAFT");
    const slots=new Set();for(const field of c.fields){if(!field||!Number.isSafeInteger(field.slot)||field.slot<0||slots.has(field.slot))throw Error("INVALID_DRAFT");slots.add(field.slot);}
    const prior=db.get("visible",c.objectId)||db.get("confirmed",c.objectId);
    if((prior?.version??"0")!==c.baseVersion)throw Error("LOCAL_BASE_CONFLICT");
    if(pending.some(row=>row.value.status==="conflict"&&row.value.changes.some(old=>old.objectId===c.objectId)))throw Error("CONFLICT_REVIEW_REQUIRED");
    bases.push({objectId:c.objectId,value:prior});
   }
   const meta=db.get("confirmed",META),counter=(sync.decimal(meta.counter)+1n).toString();sync.decimal(counter,true);
   db.put("confirmed",META,{...meta,counter});db.put("outbox",id,{status:"draft",counter,changes,bases});
   for(const c of changes)db.put("visible",c.objectId,overlay(c));
  });return id;
 }
 async prepare(id,context){
  const draft=this.store.get("outbox",id);if(!draft||draft.status==="conflict")throw Error("DRAFT_UNAVAILABLE");
  if(context.state.vaultId!==this.scope.vaultId||context.deviceId!==this.scope.deviceId||context.epoch!==this.scope.epoch)throw Error("REPLICA_SCOPE_MISMATCH");
  if(draft.record)return p.decode(draft.record);
  if(this.pending().some(row=>sync.decimal(row.value.counter)<sync.decimal(draft.counter)&&row.value.changes.some(c=>draft.changes.some(next=>next.objectId===c.objectId))))throw Error("WAITING_FOR_PREVIOUS_EDIT");
  for(const c of draft.changes)if((this.store.get("confirmed",c.objectId)?.version??"0")!==c.baseVersion)throw Error("LOCAL_BASE_CONFLICT");
  const record=await sync.createBatch({...context,counter:draft.counter,mutationId:id,changes:draft.changes});
  this.store.transaction(db=>{const current=db.get("outbox",id);if(!current||!p.encode(current).equals(p.encode(draft)))throw Error("DRAFT_CHANGED");db.put("outbox",id,{...draft,status:"prepared",record:p.encode(record)});});
  return record;
 }
 async applyChange({record,result},context){
  sync.verifyReceipt(record,result);const meta=this.store.get("confirmed",META);
  if(context.state.vaultId!==this.scope.vaultId||context.epoch!==this.scope.epoch)throw Error("REPLICA_SCOPE_MISMATCH");
  if(sync.decimal(result.seq)!==sync.decimal(meta.cursor)+1n)throw Error("SYNC_CURSOR_MISMATCH");
  const objects=await sync.decryptBatch(record,{...context,lastCounter:meta.deviceCounters.find(d=>d.deviceId===record.body.deviceId)?.counter??"0"});
  this.store.transaction(db=>{
   const current=db.get("confirmed",META);if(!p.encode(current).equals(p.encode(meta)))throw Error("REPLICA_CHANGED");
   const local=db.get("outbox",record.body.mutationId);if(local&&(!local.record||!local.record.equals(p.encode(record))))throw Error("MUTATION_ID_COLLISION");
   for(const object of objects)if((db.get("confirmed",object.objectId)?.version??"0")!==object.baseVersion)throw Error("CONFIRMED_VERSION_MISMATCH");
   if(local)db.delete("outbox",record.body.mutationId);
   const pending=this.pending();
   for(const object of objects){db.put("confirmed",object.objectId,object);if(!pending.some(row=>row.value.changes.some(c=>c.objectId===object.objectId)))db.put("visible",object.objectId,{...object,pending:false});}
   db.put("confirmed",META,{...meta,cursor:result.seq,deviceCounters:[...meta.deviceCounters.filter(d=>d.deviceId!==record.body.deviceId),{deviceId:record.body.deviceId,counter:record.body.counter}]});
  });
 }
 preserveConflict(id){this.store.transaction(db=>{const draft=db.get("outbox",id);if(!draft)throw Error("DRAFT_UNAVAILABLE");db.put("recovery",id,draft);db.put("outbox",id,{...draft,status:"conflict"});});}
 async acknowledgeSnapshot({record,result},context){
  sync.verifyReceipt(record,result);
  if(context.state.vaultId!==this.scope.vaultId||context.epoch!==this.scope.epoch)throw Error("REPLICA_SCOPE_MISMATCH");
  const objects=await sync.decryptBatch(record,{...context,lastCounter:"0"});
  this.store.transaction(db=>{
   const meta=db.get("confirmed",META),draft=db.get("outbox",record.body.mutationId);
   if(!draft?.record||!draft.record.equals(p.encode(record)))throw Error("MUTATION_ID_COLLISION");
   if(sync.decimal(result.seq)>sync.decimal(meta.cursor))throw Error("SYNC_CURSOR_MISMATCH");
   for(const object of objects){
    const confirmed=db.get("confirmed",object.objectId);
    if(!confirmed||sync.decimal(confirmed.version)<sync.decimal(object.version))throw Error("SNAPSHOT_OBJECT_ROLLBACK");
    if(confirmed.version===object.version&&!p.encode(confirmed).equals(p.encode(object)))throw Error("SNAPSHOT_OBJECT_FORK");
   }
   db.delete("outbox",record.body.mutationId);
   const pending=this.pending();
   for(const object of objects){
    const latest=pending.flatMap(row=>row.value.changes).filter(c=>c.objectId===object.objectId).at(-1);
    db.put("visible",object.objectId,latest?overlay(latest):{...db.get("confirmed",object.objectId),pending:false});
   }
  });
 }
 async installSnapshot({snapshot,history,keyForGeneration,pages}){
  const before=this.store.get("confirmed",META),prefix="$snapshot-"+randomBytes(16).toString("hex")+"-";
  const staged=()=>rows(this.store,"recovery").filter(row=>row.id.startsWith(prefix));
  const verifier=new SnapshotVerifier({snapshot,history,keyForGeneration,epoch:this.scope.epoch,minimumSeq:before.cursor,stage:async value=>this.store.put("recovery",prefix+value.objectId,value)});
  try{
   for await(const page of pages)await verifier.addPage(page);
   const verified=verifier.finish();
   this.store.transaction(db=>{
    const current=db.get("confirmed",META);
    if(!p.encode(current).equals(p.encode(before)))throw Error("REPLICA_CHANGED");
    const values=staged(),map=new Map(values.map(row=>[row.value.objectId,row.value]));
    // A server cannot erase or roll back an object already pinned locally.
    for(const row of rows(db,"confirmed"))if(row.id!==META){
     const next=map.get(row.id);if(!next||sync.decimal(next.version)<sync.decimal(row.value.version))throw Error("SNAPSHOT_OBJECT_ROLLBACK");
     if(next.version===row.value.version&&!p.encode(next).equals(p.encode(row.value)))throw Error("SNAPSHOT_OBJECT_FORK");
    }
    for(const bucket of ["confirmed","visible"])for(const row of rows(db,bucket))if(row.id!==META)db.delete(bucket,row.id);
    for(const {value} of values){db.put("confirmed",value.objectId,value);db.put("visible",value.objectId,{...value,pending:false});}
    // Snapshot membership/manifest is not an acknowledgement of local drafts.
    for(const row of this.pending())for(const change of row.value.changes)db.put("visible",change.objectId,overlay(change));
    const counters=new Map(before.deviceCounters.map(d=>[d.deviceId,sync.decimal(d.counter)]));
    for(const d of verified.deviceCounters){const n=sync.decimal(d.counter);if(n>(counters.get(d.deviceId)||0n))counters.set(d.deviceId,n);}
    const counter=sync.decimal(before.counter)> (counters.get(this.scope.deviceId)||0n)?before.counter:(counters.get(this.scope.deviceId)||0n).toString();
    db.put("confirmed",META,{...before,cursor:verified.cursor,counter,deviceCounters:[...counters].map(([deviceId,n])=>({deviceId,counter:n.toString()}))});
    for(const row of values)db.delete("recovery",row.id);
   });
  }catch(error){
   // Only this attempt's encrypted staging copies; never live state or drafts.
   try{this.store.transaction(db=>{for(const row of staged())db.delete("recovery",row.id);});}catch{}
   throw error;
  }
 }
}
module.exports={EncryptedReplica};
