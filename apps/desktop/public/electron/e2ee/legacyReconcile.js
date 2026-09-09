const {createHash}=require("node:crypto"),p=require("./protocol");
const identity=row=>JSON.stringify([row.entityType,row.parentId||"",row.entityId]);
const equal=(a,b)=>p.encode(a).equals(p.encode(b));
const live=row=>row&&row.operation!=="delete"&&row.fields?.deleted_at==null;
// Conservative three-way merge. Structural/recurrence edits require review.
function compareEdit(entry,base,current){
 const review=reason=>({status:"REVIEW_REQUIRED",reason});
 if(entry.status!=="pending")return review("ACK_OR_REJECTION_REVIEW");
 let edit;try{edit=JSON.parse(entry.request);}catch{return review("INVALID_REQUEST");}
 if(!edit||edit.clientChangeId!==entry.change_id||edit.operation!=="patch"||
  !["task","category","subtask"].includes(edit.entityType))return review("STRUCTURAL_EDIT");
 if(!base||identity(base)!==identity(edit)||base.version!==edit.baseVersion)return review("BASE_UNAVAILABLE");
 if(!live(base)||!live(current)||identity(current)!==identity(edit))return review("DELETED_OR_MISSING");
 const changes=edit.changes;
 if(!changes||typeof changes!=="object"||Array.isArray(changes))return review("INVALID_FIELDS");
 const keys=Object.keys(changes);
 if(!keys.length||keys.some(key=>!["title","memo"].includes(key)||typeof changes[key]!=="string"))return review("DEPENDENT_FIELDS");
 if(keys.some(key=>!Object.hasOwn(base.fields,key)||!Object.hasOwn(current.fields,key)))return review("BASE_UNAVAILABLE");
 if(keys.some(key=>!equal(current.fields[key],base.fields[key])&&!equal(current.fields[key],changes[key])))return review("FIELD_CONFLICT");
 if(keys.every(key=>equal(current.fields[key],changes[key])))return {status:"ALREADY_PRESENT"};
 return {status:"READY",row:{...current,fields:{...current.fields,...changes}}};
}
function intake(store,id){
 if(typeof id!=="string"||!/^[a-f0-9]{32}$/.test(id))throw Error("INVALID_INTAKE_ID");
 const prefix="$legacy-pending-"+id,manifest=store.get("recovery",prefix);
 if(!manifest||manifest.phase!=="REVIEW_REQUIRED"||manifest.accountId!==store.scope().accountId||
  !Number.isSafeInteger(manifest.pages)||manifest.pages<0||manifest.pages>100000)throw Error("INTAKE_NOT_READY");
 const hash=createHash("sha256"),bases=new Map(),entries=[];let count=0,bytes=0;
 for(let index=0;index<manifest.pages;index++){
  const raw=store.get("recovery",prefix+"-page-"+String(index).padStart(8,"0"));
  if(!Buffer.isBuffer(raw))throw Error("INTAKE_INCOMPLETE");
  bytes+=raw.length;if(bytes>128*1024*1024)throw Error("INTAKE_LIMIT");
  hash.update(raw);const page=p.decode(raw);
  if(!Array.isArray(page.rows)||!["confirmed_entities","outbox","recovery_items"].includes(page.table))throw Error("INTAKE_INVALID");
  count+=page.rows.length;
  for(const row of page.rows){
   if(page.table==="confirmed_entities"){
    let base;try{base=JSON.parse(row.payload);}catch{continue;}
    if(!base||!base.entityType||!base.entityId)continue;
    const key=identity(base);if(bases.has(key))throw Error("INTAKE_DUPLICATE_BASE");bases.set(key,base);
   }else if(page.table==="outbox")entries.push(row);
  }
 }
 if(count!==manifest.count||bytes!==manifest.bytes||hash.digest("hex")!==manifest.digest)throw Error("INTAKE_DIGEST_MISMATCH");
 if(entries.length>10000)throw Error("INTAKE_LIMIT");
 return {bases,entries};
}
function currentObjects(store){
 const result=new Map();let after="";
 for(;;){
  const page=store.entries("confirmed",after,256);
  for(const {id,value} of page){
   if(id==="$sync-state"||value.fields?.length!==1||value.fields[0].slot!==0)continue;
   const row=value.fields[0].value;if(!row?.entityType||!row.entityId)continue;
   const key=identity(row);if(result.has(key))throw Error("CANONICAL_ID_COLLISION");
   result.set(key,{object:value,row:value.deleted?{...row,operation:"delete"}:row});
  }
  if(page.length<256)return result;after=page.at(-1).id;
 }
}
// A decision and any resulting draft commit together. Sources are never removed.
function reconcileLegacyPending({replica,id}){
 const store=replica.store;
 return store.transaction(db=>{
  const {bases,entries}=intake(db,id),objects=currentObjects(db),seen=new Set(),summary={queued:0,review:0,present:0,previous:0};
  for(const entry of entries){
   if(typeof entry.change_id!=="string"||!entry.change_id)throw Error("INVALID_CHANGE_ID");
   const decisionKey="$legacy-decision-"+id+"-"+createHash("sha256").update(entry.change_id).digest("hex");
   if(db.get("recovery",decisionKey)){summary.previous++;continue;}
   let edit;try{edit=JSON.parse(entry.request);}catch{}
   const key=edit&&identity(edit),target=objects.get(key);
   let decision=compareEdit(entry,bases.get(key),target?.row);
   if(seen.has(key))decision={status:"REVIEW_REQUIRED",reason:"DEPENDENT_EDIT"};
   seen.add(key);
   if(target&&replica.pending().some(item=>item.value.changes.some(change=>change.objectId===target.object.objectId)))
    decision={status:"REVIEW_REQUIRED",reason:"LOCAL_PENDING_CONFLICT"};
   if(decision.status==="READY"){
    const draftId=replica.enqueue([{objectId:target.object.objectId,baseVersion:target.object.version,deleted:false,fields:[{slot:0,value:decision.row}]}]);
    decision={status:"QUEUED",draftId};summary.queued++;
   }else if(decision.status==="ALREADY_PRESENT")summary.present++;
   else summary.review++;
   db.put("recovery",decisionKey,{...decision,changeId:entry.change_id});
  }
  return summary;
 });
}
module.exports={compareEdit,reconcileLegacyPending};
