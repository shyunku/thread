const {outboxDetail}=require("./outboxReview");
// Explicit local decision only. Signed/uncertain requests must never be rewritten.
function resolveUnsignedConflict(replica,{id,objectId,expectedRevision,choice}={}){
 if(typeof id!=="string"||!/^[a-f0-9]{32}$/.test(id)||typeof objectId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(objectId)||
  typeof expectedRevision!=="string"||!/^[a-f0-9]{64}$/.test(expectedRevision)||!["local","current"].includes(choice))throw Error("INVALID_RESOLUTION");
 return replica.store.transaction(db=>{
  const key="$resolved-conflict-"+id,previous=db.get("recovery",key);
  if(previous){
   if(previous.objectId!==objectId||previous.revision!==expectedRevision||previous.choice!==choice)throw Error("RESOLUTION_CHANGED");
   return previous.result;
  }
  const draft=db.get("outbox",id);
  if(!draft||draft.status!=="conflict")throw Error("CONFLICT_REQUIRED");
  if(draft.record)throw Error("ACK_RECONCILIATION_REQUIRED");
  if(draft.changes.length!==1||draft.changes[0].objectId!==objectId)throw Error("MULTI_OBJECT_REVIEW_REQUIRED");
  outboxDetail(db,{id,objectId,expectedRevision});
  const local=draft.changes[0],current=db.get("confirmed",objectId);
  if(!current||current.deleted||local.deleted)throw Error("DELETION_REVIEW_REQUIRED");
  if(replica.pending().some(row=>row.id!==id&&row.value.changes.some(change=>change.objectId===objectId)))throw Error("DEPENDENT_REVIEW_REQUIRED");
  // Archive, remove active draft, restore the confirmed overlay and optionally
  // enqueue the user's entire local value against the latest verified version.
  // All writes roll back together if enqueue or the decision record fails.
  db.delete("outbox",id);
  db.put("visible",objectId,{...current,pending:false});
  const newId=choice==="local"?replica.enqueue([{...local,baseVersion:current.version}]):null;
  const result={phase:newId?"QUEUED":"CURRENT_SELECTED",newId};
  db.put("recovery",key,{original:draft,objectId,revision:expectedRevision,choice,result});
  return result;
 });
}
module.exports={resolveUnsignedConflict};
