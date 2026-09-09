const {randomBytes}=require("node:crypto");
const p=require("./protocol"),sync=require("./syncProtocol");
const META="$sync-state";
class EncryptedReplica {
 constructor(store,scope){
  this.store=store;
  if(!scope||Object.keys(scope).length!==3||!["vaultId","epoch","deviceId"].every(k=>typeof scope[k]==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(scope[k])))throw Error("INVALID_REPLICA_SCOPE");
  this.scope=p.decode(p.encode(scope));
  store.transaction(db=>{const meta=db.get("confirmed",META);if(meta){if(!p.encode(meta.scope).equals(p.encode(scope)))throw Error("REPLICA_SCOPE_MISMATCH");}else db.put("confirmed",META,{scope:this.scope,cursor:"0",counter:"0",deviceCounters:[]});});
 }
 pending(){const all=[];let after="";for(;;){const page=this.store.entries("outbox",after,100);all.push(...page);if(page.length<100)return all;after=page[page.length-1].id;if(all.length>=10000)throw Error("OUTBOX_LIMIT");}}
 enqueue(changes){
  const id=randomBytes(16).toString("hex");this.store.transaction(db=>{
   if(!Array.isArray(changes)||changes.length<1||changes.length>100)throw Error("INVALID_DRAFT");
   const pending=this.pending(),ids=new Set();
   for(const c of changes){if(!c||typeof c.objectId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(c.objectId)||ids.has(c.objectId))throw Error("INVALID_DRAFT");ids.add(c.objectId);
    sync.decimal(c.baseVersion);if((db.get("confirmed",c.objectId)?.version??"0")!==c.baseVersion)throw Error("LOCAL_BASE_CONFLICT");
    if(pending.some(row=>row.value.changes.some(old=>old.objectId===c.objectId)))throw Error("PENDING_OBJECT_EXISTS");
   }
   const meta=db.get("confirmed",META),counter=(sync.decimal(meta.counter)+1n).toString();sync.decimal(counter,true);
   db.put("confirmed",META,{...meta,counter});db.put("outbox",id,{status:"draft",counter,changes});
   for(const c of changes)db.put("visible",c.objectId,{...c,pending:true});
  });return id;
 }
 async prepare(id,context){
  const draft=this.store.get("outbox",id);if(!draft||draft.status==="conflict")throw Error("DRAFT_UNAVAILABLE");
  if(draft.record)return p.decode(draft.record);
  if(context.state.vaultId!==this.scope.vaultId||context.deviceId!==this.scope.deviceId||context.epoch!==this.scope.epoch)throw Error("REPLICA_SCOPE_MISMATCH");
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
}
module.exports={EncryptedReplica};
