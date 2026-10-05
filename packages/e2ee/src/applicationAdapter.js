const {randomBytes,createHash}=require("./platform"),p=require("./protocol");
const {command,entityLists,mutationTopics}=require("./model/entities");
const {optimistic,identity}=require("./model/optimistic");
const {prepareSchedule,completeRecurring}=require("./recurrence");
const clean=value=>JSON.parse(JSON.stringify(value));
class ApplicationAdapter{
 constructor(replica,{now=()=>Date.now()}={}){this.replica=replica;this.now=now;}
 objects(){
  const objects=new Map();let after="";
  for(let n=0;n<4000;n++){
   const page=this.replica.store.entries("visible",after,256);
   for(const {value} of page){
    if(value.deleted)continue;
    if(value.fields?.length!==1||value.fields[0].slot!==0)throw Error("UNSUPPORTED_APPLICATION_OBJECT");
    const row=value.fields[0].value;
    if(!row||!["task","category","subtask","taskCategory"].includes(row.entityType)||typeof row.entityId!=="string"||!row.fields)throw Error("INVALID_APPLICATION_OBJECT");
    const key=identity(row);if(objects.has(key))throw Error("CANONICAL_ID_COLLISION");
    objects.set(key,{object:value,row:{...row,version:value.version}});
   }
   if(page.length<256)return objects;after=page.at(-1).id;
  }
  throw Error("APPLICATION_OBJECT_LIMIT");
 }
 view(){return {rows:[...this.objects().values()].map(item=>item.row)};}
 lists(){return entityLists(this.view());}
 mutate(topic,args){
  if(!mutationTopics.has(topic))throw Error("UNSUPPORTED_APPLICATION_ACTION");
  return this.replica.store.transaction(db=>{
   const objects=this.objects(),probe=command(topic,args,{rows:[...objects.values()].map(item=>item.row)});
   // A recurring completion edits rows in place, so it works on copies and compares
   // every row. Other actions replace only the rows they change (model/optimistic),
   // so unchanged rows are skipped by identity instead of re-encoding all of them.
   const recurring=probe.operation==="completeRecurringTask";
   const rows=new Map([...objects].map(([key,item])=>[key,recurring?clean(item.row):item.row]));
   const action=recurring?command(topic,args,{rows:[...rows.values()]}):probe;
   const now=this.now();
   if(recurring)completeRecurring(rows,action,db.scope().accountId,now);
   else optimistic(rows,{...action,localTime:now});
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
   return this.replica.enqueue(changes);
  });
 }
}
module.exports={ApplicationAdapter,mutationTopics};
