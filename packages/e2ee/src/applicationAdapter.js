const {randomBytes,createHash}=require("./platform"),p=require("./protocol");
const {command,expand,entityLists,mutationTopics,compositeTopics}=require("./model/entities");
const {optimistic,identity}=require("./model/optimistic");
const {prepareSchedule,completeRecurring}=require("./recurrence");
const {bucketRows}=require("./bucketCache");
const clean=value=>JSON.parse(JSON.stringify(value));
// Row types this version knows. A newer app may add others (#77: device names); those are left
// as they are, unread and never rewritten, instead of stopping every list.
const KNOWN_TYPES=["task","category","subtask","taskCategory"];
const unknownType=row=>!!row&&typeof row.entityType==="string"&&!KNOWN_TYPES.includes(row.entityType)&&typeof row.entityId==="string"&&!!row.fields;
class ApplicationAdapter{
 constructor(replica,{now=()=>Date.now()}={}){this.replica=replica;this.now=now;}
 // Visible objects come from the store's decoded-bucket cache: after the first read only
 // rows written since are decoded again (#98). Cached values are shared and read-only;
 // edits build new rows (model/optimistic) or work on copies (recurring completion).
 objects(){
  const objects=new Map();let all;
  try{all=bucketRows(this.replica.store,"visible");}
  catch(error){if(error.message==="BUCKET_PAGE_LIMIT")throw Error("APPLICATION_OBJECT_LIMIT");throw error;}
  for(const {value} of all){
   if(value.deleted)continue;
   if(value.fields?.length!==1||value.fields[0].slot!==0)throw Error("UNSUPPORTED_APPLICATION_OBJECT");
   const row=value.fields[0].value;
   if(unknownType(row))continue;
   if(!row||!KNOWN_TYPES.includes(row.entityType)||typeof row.entityId!=="string"||!row.fields)throw Error("INVALID_APPLICATION_OBJECT");
   const key=identity(row);if(objects.has(key))throw Error("CANONICAL_ID_COLLISION");
   objects.set(key,{object:value,row:{...row,version:value.version}});
  }
  return objects;
 }
 view(){return {rows:[...this.objects().values()].map(item=>item.row)};}
 lists(){return entityLists(this.view());}
 mutate(topic,args){
  const composite=compositeTopics.has(topic);
  if(!mutationTopics.has(topic)&&!composite)throw Error("UNSUPPORTED_APPLICATION_ACTION");
  return this.replica.store.transaction(db=>{
   const objects=this.objects(),base={rows:[...objects.values()].map(item=>item.row)},now=this.now();
   // A composite (duplicate, delete a category in use) runs its steps on one row map,
   // so they are queued together as one change set.
   const steps=composite?expand(topic,args,base,now):null,probe=composite?null:command(topic,args,base);
   // A recurring completion edits rows in place, so it works on copies and compares
   // every row. Other actions replace only the rows they change (model/optimistic),
   // so unchanged rows are skipped by identity instead of re-encoding all of them.
   const recurring=probe?.operation==="completeRecurringTask";
   const rows=new Map([...objects].map(([key,item])=>[key,recurring?clean(item.row):item.row]));
   if(recurring)completeRecurring(rows,command(topic,args,{rows:[...rows.values()]}),db.scope().accountId,now);
   else if(steps)for(const [step,stepArgs] of steps)optimistic(rows,{...command(step,stepArgs,{rows:[...rows.values()]}),localTime:now});
   else optimistic(rows,{...probe,localTime:now});
   const changes=[];
   for(const [key,raw] of rows){
    const old=objects.get(key);
    if(!recurring&&old&&raw===old.row&&!(raw.entityType==="task"&&raw.fields.repeat_period&&!raw.fields.repeat_start_at))continue;
    const row=clean(raw);prepareSchedule(row);
    if(old&&p.encode(clean(old.row)).equals(p.encode(row)))continue;
    const mapKey="$application-object-"+createHash("sha256").update(key).digest("hex");
    const mapped=db.get("recovery",mapKey);
    if(!old&&mapped)throw Error("ENTITY_RECREATE_REVIEW_REQUIRED");
    const objectId=old?.object.objectId||randomBytes(16).toString("hex");
    db.put("recovery",mapKey,objectId);
    changes.push({objectId,baseVersion:old?.object.version||"0",deleted:row.operation==="delete",
     fields:row.operation==="delete"?[]:[{slot:0,value:row}]});
   }
   if(!changes.length)return null;
   // A large structural edit is rejected atomically rather than partially queued.
   if(!composite)return this.replica.enqueue(changes);
   // A composite always lists its deletions last, in one draft or across several.
   const ordered=[...changes.filter(change=>!change.deleted),...changes.filter(change=>change.deleted)];
   if(ordered.length<=100)return this.replica.enqueue(ordered);
   // A composite (a category on 100+ tasks, a copy with 100+ subtasks) may not fit one
   // draft. It is queued as several drafts in this same local transaction, deletions
   // last. Each later draft repeats one row of the draft before it (an unchanged
   // rewrite), so prepare holds it back until that draft is through
   // (WAITING_FOR_PREVIOUS_EDIT) and a conflict on that draft rebases it along, still
   // after it. The repeat is dropped as a no-op once rebased, so the order is kept
   // through one conflict; a second conflict on the same draft can still reorder them.
   let id=null,link=null;
   for(let i=0;i<ordered.length;){
    const size=link?99:100,chunk=ordered.slice(i,i+size);i+=size;
    id=this.replica.enqueue(link?[{...link,baseVersion:(BigInt(link.baseVersion)+1n).toString()},...chunk]:chunk);
    link=[...chunk].reverse().find(change=>!change.deleted)||null;
   }
   return id;
  });
 }
}
module.exports={ApplicationAdapter,mutationTopics,compositeTopics};
