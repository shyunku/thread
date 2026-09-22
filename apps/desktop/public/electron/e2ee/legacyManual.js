const p=require("./protocol"),{createHash,randomBytes}=require("node:crypto");
const {intake}=require("./legacyReconcile"),{ApplicationAdapter}=require("./applicationAdapter");
const {optimistic,identity}=require("../sync-v2/replica"),{completeRecurring,prepareSchedule}=require("./recurrence");
const clean=value=>JSON.parse(JSON.stringify(value)),hash=value=>createHash("sha256").update(p.encode(value)).digest("hex");
const decisionKey=(id,changeId)=>"$legacy-decision-"+id+"-"+createHash("sha256").update(changeId).digest("hex");
const allowed={task:["title","memo","created_at","done","done_at","due_date","repeat_period","repeat_start_at"],category:["title","color","secret","locked","created_at"],subtask:["title","created_at","done","done_at","due_date"],taskCategory:[]};
function collect(replica,id){
 const copied=intake(replica.store,id),entries=copied.entries.filter(row=>{
  const decision=replica.store.get("recovery",decisionKey(id,row.change_id));
  return !decision||decision.status==="REVIEW_REQUIRED";
 });
 const objects=new ApplicationAdapter(replica).objects(),pending=replica.pending();
 return {entries,objects,pending,revision:hash({id,entries,objects:[...objects],pending,meta:replica.store.get("confirmed","$sync-state")})};
}
function action(entry){
 const edit=JSON.parse(entry.request),types=allowed[edit?.entityType];
 if(!types||typeof edit.entityId!=="string"||!edit.entityId||edit.entityId.length>256||edit.clientChangeId!==entry.change_id)throw Error("INVALID_LEGACY_ACTION");
 const operations=edit.entityType==="task"?["create","patch","delete","move","completeRecurringTask"]:edit.entityType==="taskCategory"?["add","remove"]:["create","patch","delete"];
 if(!operations.includes(edit.operation))throw Error("INVALID_LEGACY_ACTION");
 if(["subtask","taskCategory"].includes(edit.entityType)&&(typeof edit.parentId!=="string"||!edit.parentId||edit.parentId.length>256))throw Error("INVALID_LEGACY_ACTION");
 const changes=edit.changes||{};
 if(typeof changes!=="object"||Array.isArray(changes)||Object.keys(changes).some(key=>!types.includes(key)))throw Error("INVALID_LEGACY_FIELDS");
 for(const [key,value] of Object.entries(changes)){
  if(["title","memo","color","repeat_period"].includes(key)){if(typeof value!=="string"||value.length>100000)throw Error("INVALID_LEGACY_FIELDS");}
  else if(["done","secret","locked"].includes(key)){if(typeof value!=="boolean")throw Error("INVALID_LEGACY_FIELDS");}
  else if(!Number.isSafeInteger(value)||value<0)throw Error("INVALID_LEGACY_FIELDS");
 }
 if(edit.categoryIds!==undefined&&(!Array.isArray(edit.categoryIds)||edit.categoryIds.length>100||edit.categoryIds.some(id=>typeof id!=="string"||!id||id.length>256)))throw Error("INVALID_LEGACY_ACTION");
 if(edit.anchorId!=null&&(typeof edit.anchorId!=="string"||edit.anchorId.length>256))throw Error("INVALID_LEGACY_ACTION");
 return edit;
}
function review(replica,{id,offset=0}){
 if(!Number.isSafeInteger(offset)||offset<0)throw Error("INVALID_REVIEW_PAGE");
 const state=collect(replica,id),items=state.entries.slice(offset,offset+20).map(entry=>{
  let edit;try{edit=action(entry);}catch{return {changeId:entry.change_id,unsupported:true};}
  const text=JSON.stringify({entityType:edit.entityType,entityId:edit.entityId,parentId:edit.parentId,operation:edit.operation,changes:edit.changes,categoryIds:edit.categoryIds,anchorId:edit.anchorId,after:edit.after,generation:edit.generation});
  return {changeId:entry.change_id,text:text.slice(0,12000),truncated:text.length>12000};
 });
 return {revision:state.revision,items,next:offset+20<state.entries.length?offset+20:null,total:state.entries.length,canApply:state.pending.length===0};
}
function resolve(replica,{id,changeIds,expectedRevision,choice,confirmed}){
 if(confirmed!==true||!["local","current"].includes(choice)||typeof expectedRevision!=="string"||!/^[a-f0-9]{64}$/.test(expectedRevision)||
  !Array.isArray(changeIds)||!changeIds.length||changeIds.length>100||changeIds.some(id=>typeof id!=="string")||new Set(changeIds).size!==changeIds.length)throw Error("INVALID_LEGACY_SELECTION");
 return replica.store.transaction(db=>{
  const resolution="$legacy-manual-"+hash({id,changeIds:[...changeIds].sort(),expectedRevision}),old=db.get("recovery",resolution);
  if(old){if(old.choice!==choice)throw Error("RESOLUTION_CHANGED");return old.result;}
  const state=collect(replica,id);if(state.revision!==expectedRevision)throw Error("REVIEW_CHANGED");
  const selected=state.entries.filter(entry=>changeIds.includes(entry.change_id));if(selected.length!==changeIds.length)throw Error("REVIEW_CHANGED");
  let draftId=null;
  if(choice==="local"){
   if(state.pending.length)throw Error("LOCAL_PENDING_CONFLICT");
   const rows=new Map([...state.objects].map(([key,value])=>[key,clean(value.row)])),now=Date.now();
   for(const entry of selected){
    const edit=action(entry);
    if(edit.operation==="completeRecurringTask")completeRecurring(rows,edit,db.scope().accountId,now);
    else optimistic(rows,{...edit,localTime:now});
   }
   const changes=[];
   for(const [key,raw] of rows){
    const row=clean(raw),prior=state.objects.get(key);prepareSchedule(row);
    if(prior&&p.encode(clean(prior.row)).equals(p.encode(row)))continue;
    const mapKey="$application-object-"+createHash("sha256").update(key).digest("hex"),mapped=db.get("recovery",mapKey);
    if(!prior&&mapped)throw Error("ENTITY_RECREATE_REVIEW_REQUIRED");
    const objectId=prior?.object.objectId||randomBytes(16).toString("hex");
    db.put("recovery",mapKey,objectId);changes.push({objectId,baseVersion:prior?.object.version||"0",deleted:row.operation==="delete",fields:row.operation==="delete"?[]:[{slot:0,value:row}]});
   }
   if(changes.length)draftId=replica.enqueue(changes);
   require("./groupConflict").validateApplication(db);
  }
  for(const entry of selected)db.put("recovery",decisionKey(id,entry.change_id),{status:"MANUALLY_REVIEWED",choice,draftId,original:entry,expectedRevision});
  const result={phase:draftId?"QUEUED":"CURRENT_SELECTED",count:selected.length,draftId};
  db.put("recovery",resolution,{choice,result});return result;
 });
}
module.exports={review,resolve};
