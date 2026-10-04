// Read-only summaries: no signed records, keys or arbitrary recovery rows.
const p=require("./protocol"),{createHash}=require("./platform");
const same=(a,b)=>p.encode(a??null).equals(p.encode(b??null));
function fieldStatus(base,local,current,canCompare){
 if(!canCompare)return "REVIEW_REQUIRED";
 if(same(local,current))return same(base,local)?"UNCHANGED":"MATCHING_VALUES";
 if(same(base,current))return "LOCAL_ONLY";
 if(same(base,local))return "REMOTE_ONLY";
 return "FIELD_CONFLICT";
}
function outboxReviews(store,{after="",limit=20}={}){
 if(typeof after!=="string"||(after!==""&&!/^[a-f0-9]{32}$/.test(after))||!Number.isInteger(limit)||limit<1||limit>50)throw Error("INVALID_REVIEW_PAGE");
 const rows=store.entries("outbox",after,limit+1),page=rows.slice(0,limit);
 return {items:page.map(({id,value})=>({
  id,status:value.status==="conflict"?"REVIEW_REQUIRED":value.record?"ACK_UNCERTAIN":"QUEUED",
  reason:value.reviewReason==="STALE_SIGNED_REQUEST"?"STALE_SIGNED_REQUEST":value.status==="conflict"?"OBJECT_CONFLICT":null,
  objectCount:value.changes.length,
  objects:value.changes.slice(0,20).map(change=>({id:change.objectId,baseVersion:change.baseVersion,deleted:change.deleted,fieldCount:change.fields.length})),
  moreObjects:value.changes.length>20
 })),next:page.at(-1)?.id||after,more:rows.length>limit};
}
function preview(field){
 if(!field)return {present:false,text:"",truncated:false};
 const text=JSON.stringify(field.value)??"null";
 return {present:true,text:text.slice(0,2000),truncated:text.length>2000};
}
function outboxDetail(store,{id,objectId,offset=0,expectedRevision}={}){
 if(typeof id!=="string"||!/^[a-f0-9]{32}$/.test(id)||typeof objectId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(objectId)||
  !Number.isInteger(offset)||offset<0||offset>768)throw Error("INVALID_REVIEW_DETAIL");
 if(expectedRevision!==undefined&&(typeof expectedRevision!=="string"||!/^[a-f0-9]{64}$/.test(expectedRevision)))throw Error("INVALID_REVIEW_DETAIL");
 if(offset>0&&!expectedRevision)throw Error("REVIEW_REVISION_REQUIRED");
 const draft=store.get("outbox",id),local=draft?.changes.find(change=>change.objectId===objectId);
 if(!local)throw Error("REVIEW_NOT_FOUND");
 const base=draft.bases?.find(entry=>entry.objectId===objectId)?.value??null,current=store.get("confirmed",objectId);
 const revision=createHash("sha256").update(p.encode(draft)).update(p.encode(current)).digest("hex");
 if(expectedRevision&&expectedRevision!==revision)throw Error("REVIEW_CHANGED");
 const slots=[...new Set([...(base?.fields||[]),...local.fields,...(current?.fields||[])].map(field=>field.slot))].sort((a,b)=>a-b);
 const fields=slots.slice(offset,offset+20).map(slot=>{
  const b=base?.fields?.find(field=>field.slot===slot),l=local.fields.find(field=>field.slot===slot),c=current?.fields?.find(field=>field.slot===slot);
  return {slot,base:preview(b),local:preview(l),current:preview(c),
   status:fieldStatus(b,l,c,!!base&&base.version===local.baseVersion&&!base.deleted&&!!current&&!current.deleted&&!local.deleted)};
 });
 return {id,objectId,revision,canRetrySigned:!!draft.record,canResolve:draft.status==="conflict"&&!draft.record&&draft.changes.length===1&&!!current&&!current.deleted&&!local.deleted,baseVersion:local.baseVersion,currentVersion:current?.version??null,
  baseMissing:!base,currentMissing:!current,localDeleted:local.deleted,currentDeleted:current?.deleted??false,
  fields,next:offset+fields.length,more:offset+fields.length<slots.length};
}
module.exports={outboxReviews,outboxDetail};
