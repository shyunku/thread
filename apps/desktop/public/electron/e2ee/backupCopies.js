const {randomUUID}=require("node:crypto");
const {entityLists}=require("../sync-v2/entities");
const {identity}=require("../sync-v2/replica"),{ApplicationAdapter}=require("./applicationAdapter");
function restoreCopies(replica,source,backupId){
 return replica.store.transaction(db=>{
  const marker="$restored-backup-copies-"+backupId,prior=db.get("recovery",marker);
  if(prior)return prior;
  const objects=new Map();let after="";
  for(;;){
   const page=source.entries("recovery",after,128);
   for(const row of page){
    const value=row.value;
    if(!row.id.startsWith("backup-record-")||!["confirmed","visible"].includes(value.bucket)||value.id.startsWith("$"))continue;
    const old=objects.get(value.id);
    if(!old||value.bucket==="visible")objects.set(value.id,value);
    if(objects.size>1000)throw Error("BACKUP_RESTORE_LIMIT");
   }
   if(page.length<128)break;after=page.at(-1).id;
  }
  const rows=[],seen=new Set();
  for(const {value} of objects.values()){
   if(value.deleted)continue;
   const row=value.fields?.length===1&&value.fields[0].slot===0?value.fields[0].value:null;
   if(!row||!["task","category","subtask","taskCategory"].includes(row.entityType)||!row.fields||typeof row.entityId!=="string")throw Error("UNSUPPORTED_BACKUP_OBJECT");
   const key=identity(row);if(seen.has(key))throw Error("BACKUP_ENTITY_COLLISION");seen.add(key);rows.push(row);
  }
  const lists=entityLists({rows}),tasks=new Map(lists.tasks.map(row=>[row.tid,randomUUID()])),categories=new Map(lists.categories.map(row=>[row.cid,randomUUID()]));
  if(lists.subtasks.some(row=>!tasks.has(row.tid))||lists.relations.some(row=>!tasks.has(row.tid)||!categories.has(row.cid)))throw Error("BACKUP_DEPENDENCY_MISSING");
  const app=new ApplicationAdapter(replica);
  for(const row of lists.categories)app.mutate("category/createCategory",[{...row,cid:categories.get(row.cid)}]);
  for(const row of lists.tasks)app.mutate("task/addTask",[{...row,tid:tasks.get(row.tid),categories:lists.relations.filter(rel=>rel.tid===row.tid).map(rel=>categories.get(rel.cid))}]);
  for(const row of lists.subtasks)app.mutate("task/createSubtask",[{...row,sid:randomUUID()},tasks.get(row.tid)]);
  require("./groupConflict").validateApplication(db);
  const result={phase:"COPIES_QUEUED",count:lists.tasks.length+lists.categories.length+lists.subtasks.length};
  db.put("recovery",marker,result);return result;
 });
}
module.exports={restoreCopies};
