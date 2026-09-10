// Read-only summaries: no signed records, keys or arbitrary recovery rows.
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
module.exports={outboxReviews};
