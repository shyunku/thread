const {v5}=require("./uuid");
const {identity,optimistic}=require("./model/optimistic");
const MAX_TIME=253402300799999,MAX_GENERATION=18446744073709551615n;
function timestamp(value,positive=false){
 if(!Number.isSafeInteger(value)||value<(positive?1:0)||value>MAX_TIME)throw Error("RECURRENCE_RANGE");
 return value;
}
function nextDue(start,due,period,now){
 if(!["day","week","month","year"].includes(period))throw Error("INVALID_REPEAT_PERIOD");
 timestamp(start,true);timestamp(due,true);timestamp(now);
 const date=new Date(start);
 for(let i=0;i<100000;i++){
  const value=date.getTime();timestamp(value,true);
  if(value>=now&&value>due)return value;
  if(period==="day"||period==="week")date.setUTCDate(date.getUTCDate()+(period==="day"?1:7));
  else if(period==="month")date.setUTCMonth(date.getUTCMonth()+1);
  else date.setUTCFullYear(date.getUTCFullYear()+1);
 }
 throw Error("RECURRENCE_RANGE");
}
function occurrenceID(accountId,taskId,generation,child){
 // Match Go json.Marshal string escaping and uuid.NameSpaceOID.
 const text=JSON.stringify([accountId,taskId,generation,child]).replace(/[<>&\u2028\u2029]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"));
 return v5(text,"6ba7b812-9dad-11d1-80b4-00c04fd430c8");
}
function prepareSchedule(row){
 if(row.entityType!=="task"||row.operation==="delete"||!row.fields.repeat_period)return;
 const f=row.fields;
 if(!["day","week","month","year"].includes(f.repeat_period))throw Error("INVALID_REPEAT_PERIOD");
 if(!f.repeat_start_at)f.repeat_start_at=f.due_date;
 timestamp(f.repeat_start_at,true);timestamp(f.due_date,true);
}
function completeRecurring(rows,action,accountId,now){
 timestamp(now);
 const key=identity(action),task=rows.get(key),f=task?.fields;
 if(!task||task.operation==="delete"||f.deleted_at!=null||!f.repeat_period)throw Error("NOT_RECURRING");
 const generation=f.recurrence_generation;
 if(typeof generation!=="string"||!/^(0|[1-9][0-9]*)$/.test(generation)||BigInt(generation)>=MAX_GENERATION||action.generation!==generation)throw Error("STALE_OCCURRENCE");
 prepareSchedule(task);
 const due=nextDue(f.repeat_start_at,f.due_date,f.repeat_period,now),delta=due-f.due_date;
 const cloneId=occurrenceID(accountId,task.entityId,generation,"task");
 const children=[...rows.values()].filter(row=>row.parentId===task.entityId&&row.entityType==="subtask"&&row.operation!=="delete"&&row.fields.deleted_at==null);
 const categories=[...rows.values()].filter(row=>row.parentId===task.entityId&&row.entityType==="taskCategory"&&row.fields.present).map(row=>row.entityId);
 for(const child of children)if(child.fields.due_date)timestamp(child.fields.due_date+delta,true);
 optimistic(rows,{entityType:"task",entityId:cloneId,operation:"create",localTime:now,anchorId:task.entityId,after:false,categoryIds:categories,
  changes:{...f,done:true,done_at:now,repeat_period:"",repeat_start_at:0,recurrence_generation:"0"}});
 for(const child of children){
  optimistic(rows,{entityType:"subtask",entityId:occurrenceID(accountId,task.entityId,generation,"subtask:"+child.entityId),parentId:cloneId,operation:"create",localTime:now,changes:{...child.fields}});
  optimistic(rows,{entityType:"subtask",entityId:child.entityId,parentId:task.entityId,operation:"patch",localTime:now,
   changes:{done:false,done_at:0,due_date:child.fields.due_date?child.fields.due_date+delta:0}});
 }
 optimistic(rows,{...action,operation:"patch",localTime:now,changes:{done:false,done_at:0,due_date:due}});
}
module.exports={nextDue,occurrenceID,prepareSchedule,completeRecurring};
