const {randomBytes}=require("node:crypto");
const KEY="$reencryption-job";
function status(store){const job=store.get("recovery",KEY);return job?{phase:job.phase,generation:job.generation,count:job.count,pending:!!job.pending,reason:job.reason||null}:null;}
function authority(replica){
 const meta=replica.store.get("confirmed","$sync-state"),value=replica.store.get("recovery","$last-sync-authority");
 if(!value||value.epoch!==replica.scope.epoch||value.cursor!==meta.cursor||!Number.isSafeInteger(value.keyGeneration))throw Error("VERIFIED_SYNC_REQUIRED");
 return value;
}
function receipt(store,record){
 const job=store.get("recovery",KEY);
 if(job?.pending===record.body.mutationId&&job.epoch===record.body.epoch&&job.generation===record.body.keyGeneration)
  store.put("recovery",KEY,{...job,verified:true});
}
function execute(replica,action,input={}){
 const store=replica.store;
 if(action==="status")return status(store);
 if(!["start","step","cancel"].includes(action)||input.confirmed!==true)throw Error("REENCRYPTION_CONSENT_REQUIRED");
 return store.transaction(db=>{
  let job=db.get("recovery",KEY);
  if(action==="cancel"){
   if(!job)throw Error("REENCRYPTION_NOT_STARTED");
   // Never remove a sent/unsent draft or its evidence.
   db.put("recovery",KEY,{...job,phase:"CANCELLED"});return status(db);
  }
  const current=authority(replica);
  if(action==="start"){
   if(job&&!["DONE","CANCELLED"].includes(job.phase))throw Error("REENCRYPTION_ALREADY_PENDING");
   if(replica.pending().length)throw Error("LOCAL_PENDING_CONFLICT");
   if(job)db.put("recovery","$reencryption-history-"+job.id,job);
   job={id:randomBytes(16).toString("hex"),phase:"READY",epoch:replica.scope.epoch,generation:current.keyGeneration,after:"",count:0,pending:null};
   db.put("recovery",KEY,job);return status(db);
  }
  if(!job||!["READY","WAITING","PAUSED"].includes(job.phase))throw Error("REENCRYPTION_NOT_STARTED");
  if(current.keyGeneration!==job.generation||current.epoch!==job.epoch)throw Error("KEY_GENERATION_CHANGED");
  if(job.pending){
   if(!job.verified)throw Error("REENCRYPTION_RECEIPT_REQUIRED");
   job={...job,phase:"READY",after:job.next,count:job.count+job.batchCount,pending:null,verified:false};
  }
  if(replica.pending().length)throw Error("LOCAL_PENDING_CONFLICT");
  const page=db.entries("confirmed",job.after,100).filter(row=>row.id!=="$sync-state");
  if(!page.length){db.put("recovery",KEY,{...job,phase:"DONE"});return status(db);}
  const changes=page.map(({value})=>({objectId:value.objectId,baseVersion:value.version,deleted:value.deleted,fields:value.deleted?[]:value.fields}));
  const draft=replica.enqueue(changes);
  db.put("recovery",KEY,{...job,phase:"WAITING",pending:draft,next:page.at(-1).id,batchCount:page.length,verified:false});
  return status(db);
 });
}
function advance(replica){
 const store=replica.store,job=store.get("recovery",KEY);
 if(!job||!["READY","WAITING"].includes(job.phase))return;
 try{execute(replica,"step",{confirmed:true});}
 catch(error){
  const reason=["KEY_GENERATION_CHANGED","LOCAL_PENDING_CONFLICT","REENCRYPTION_RECEIPT_REQUIRED","VERIFIED_SYNC_REQUIRED"].includes(error.message)?error.message:"REENCRYPTION_REVIEW_REQUIRED";
  store.put("recovery",KEY,{...store.get("recovery",KEY),phase:"PAUSED",reason});
 }
}
module.exports={execute,receipt,advance};
