const {randomBytes,createHash}=require("node:crypto");
const p=require("./protocol"),{decimal}=require("./syncProtocol");
function check(value,code="INVALID_MIGRATION_RESPONSE"){if(!value)throw Error(code);}
const id=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const uuid=v=>typeof v==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
async function createMigrationRequest({state,device,deviceId,epoch,operation,parameters,now=Date.now()}){
 const approved=state.devices.get(deviceId);
 check(approved?.role==="write"&&approved.canAuthorizeDevices===true&&approved.signingKey.equals(device.signing.publicKey),"DEVICE_FORBIDDEN");
 check(id(epoch)&&id(parameters?.migrationId)&&Number.isSafeInteger(now)&&now>=0);
 if(operation==="prepare"){
  check(Object.keys(parameters).length===4&&uuid(parameters.sourceEpoch)&&uuid(parameters.sourceSnapshotId));decimal(parameters.freezeSeq);
 }else if(operation==="source-page"){
  check(Object.keys(parameters).length===2&&Number.isSafeInteger(parameters.page)&&parameters.page>=0);
 }else if(operation==="verify"){
  check(Object.keys(parameters).length===6&&uuid(parameters.snapshotId)&&/^[a-f0-9]{64}$/.test(parameters.ciphertextManifest)&&Number.isSafeInteger(parameters.sourcePageCount)&&parameters.sourcePageCount>0&&Number.isSafeInteger(parameters.sourceObjectCount)&&parameters.sourceObjectCount>=0);decimal(parameters.freezeSeq);
 }else if(operation==="commit"){
  check(Object.keys(parameters).length===4&&uuid(parameters.targetEpoch)&&/^[a-f0-9]{64}$/.test(parameters.ciphertextManifest));decimal(parameters.freezeSeq);
 }else check(["source-snapshot","status","cancel"].includes(operation)&&Object.keys(parameters).length===1);
 const body={schema:1,vaultId:state.vaultId,deviceId,epoch,membershipRevision:state.revision,keyGeneration:state.keyGeneration,operation,parameters,requestId:randomBytes(16).toString("hex"),expiresAt:now+60000};
 return {body,signature:await p.sign(device.signing.privateKey,"migration",body)};
}
// Prepare/source/cancel only. Does not upload, commit, delete original v2 data,
// change the application's active database, or interpret cached data as E2EE.
class MigrationSession{
 constructor({store,journal,history,device,deviceId,epoch,transport}){
  Object.assign(this,{store,journal,history,device,deviceId,epoch,transport});this.abort=new AbortController();
 }
 close(){this.abort.abort();}
 ready(){if(this.abort.signal.aborted)throw Error("MIGRATION_CANCELLED");}
 async request(operation,parameters){
  this.ready();const record=await createMigrationRequest({state:this.history.current,device:this.device,deviceId:this.deviceId,epoch:this.epoch,operation,parameters});
  this.ready();const method={"source-snapshot":"migrationSourceSnapshot","prepare":"migrationPrepare","status":"migrationStatus","source-page":"migrationSource","cancel":"migrationCancel","verify":"migrationVerify","commit":"migrationCommit"}[operation];
  const result=await this.transport[method](record,this.abort.signal);this.ready();return result;
 }
 validateStatus(status,plan,phase){
  check(status&&status.id===plan.migrationId&&status.vaultId===this.history.current.vaultId&&status.coordinator===this.deviceId&&
   status.sourceEpoch===plan.sourceEpoch&&status.sourceSnapshotId===plan.sourceSnapshotId&&status.freezeSeq===plan.freezeSeq&&
   status.pageCount===plan.pageCount&&Number.isSafeInteger(status.objectCount)&&status.objectCount>=0&&status.objectCount<=1000000&&
   uuid(status.targetEpoch)&&status.phase===phase);
  return status;
 }
 plan(){
  const state=this.journal.get();check(state,"MIGRATION_NOT_STARTED");
  const plan=this.store.get("recovery","$migration-plan-"+state.id);check(plan,"MIGRATION_PLAN_MISSING");return plan;
 }
 async restart(){
  this.ready();const before=this.journal.get();
  check(before?.phase==="CANCELLED","MIGRATION_PHASE_CONFLICT");
  const plan=this.plan();
  this.validateStatus(await this.request("status",{migrationId:before.id}),plan,"CANCELLED");
  return this.journal.restart(before,randomBytes(16).toString("hex"));
 }
 async refreshSource(){
  this.ready();const before=this.journal.get();
  check(before?.phase==="PREPARING","MIGRATION_PHASE_CONFLICT");
  const key="$migration-plan-"+before.id;
  const accept=remote=>{
   const current=this.store.get("recovery",key),archive=this.store.get("recovery",key+"-history")||[];
   const plan=[current,...archive].find(plan=>plan&&plan.sourceEpoch===remote.sourceEpoch&&plan.sourceSnapshotId===remote.sourceSnapshotId&&plan.freezeSeq===remote.freezeSeq&&plan.pageCount===remote.pageCount);
   check(plan,"MIGRATION_SOURCE_CHANGED");this.validateStatus(remote,plan,"FROZEN");
   this.store.transaction(db=>{
    check(p.encode(this.journal.get()).equals(p.encode(before)),"MIGRATION_CHANGED");
    if(current&&!p.encode(current).equals(p.encode(plan))&&!archive.some(row=>p.encode(row).equals(p.encode(current)))){
     check(archive.length<101,"MIGRATION_RETRY_LIMIT");db.put("recovery",key+"-history",[...archive,current]);
    }
    db.put("recovery",key,plan);
    this.journal.advance("PREPARING","FROZEN",{freezeSeq:plan.freezeSeq,sourceEpoch:plan.sourceEpoch,sourceSnapshotId:plan.sourceSnapshotId,sourcePageCount:plan.pageCount,sourceObjectCount:remote.objectCount,targetEpoch:remote.targetEpoch});
   });return remote;
  };
  try{return accept(await this.request("status",{migrationId:before.id}));}
  catch(error){if(!["NOT_FOUND","MIGRATION_NOT_FOUND"].includes(error.message))throw error;}
  // NOT_FOUND is not proof that an earlier prepare cannot arrive later.
  // Keep the SAME ID and every attempted plan; server row locking chooses one.
  const snapshot=await this.request("source-snapshot",{migrationId:before.id});
  check(snapshot&&uuid(snapshot.epoch)&&uuid(snapshot.snapshotId)&&Number.isSafeInteger(snapshot.pageCount)&&snapshot.pageCount>0&&snapshot.pageCount<=100000);decimal(snapshot.seq);
  this.store.transaction(db=>{
   check(p.encode(this.journal.get()).equals(p.encode(before)),"MIGRATION_CHANGED");
   const previous=db.get("recovery",key),archive=db.get("recovery",key+"-history")||[];
   if(previous&&!archive.some(row=>p.encode(row).equals(p.encode(previous))))archive.push(previous);
   check(archive.length<=100,"MIGRATION_RETRY_LIMIT");
   db.put("recovery",key+"-history",archive);
   db.put("recovery",key,{migrationId:before.id,sourceEpoch:snapshot.epoch,sourceSnapshotId:snapshot.snapshotId,freezeSeq:snapshot.seq,pageCount:snapshot.pageCount});
  });
  try{return await this.prepare(snapshot);}
  catch(error){
   if(!["MIGRATION_CONFLICT","INVALID_MIGRATION_RESPONSE"].includes(error.message))throw error;
   return accept(await this.request("status",{migrationId:before.id}));
  }
 }
 async prepareCurrent(){
  this.ready();
  const state=this.journal.get()||this.journal.begin(randomBytes(16).toString("hex"));
  check(["PREPARING","FROZEN"].includes(state.phase),"MIGRATION_PHASE_CONFLICT");
  const plan=this.store.get("recovery","$migration-plan-"+state.id);
  // Once prepare may have reached the server, keep the exact source and ID.
  // A stale source is an explicit conflict, never a silent new migration.
  const snapshot=plan?{epoch:plan.sourceEpoch,snapshotId:plan.sourceSnapshotId,seq:plan.freezeSeq,pageCount:plan.pageCount}:
   await this.request("source-snapshot",{migrationId:state.id});
  return this.prepare(snapshot);
 }
 async prepare(snapshot){
  this.ready();check(snapshot&&uuid(snapshot.epoch)&&uuid(snapshot.snapshotId)&&Number.isSafeInteger(snapshot.pageCount)&&snapshot.pageCount>0&&snapshot.pageCount<=100000);
  decimal(snapshot.seq);
  const state=this.journal.get()||this.journal.begin(randomBytes(16).toString("hex"));
  check(["PREPARING","FROZEN"].includes(state.phase),"MIGRATION_PHASE_CONFLICT");
  const plan={migrationId:state.id,sourceEpoch:snapshot.epoch,sourceSnapshotId:snapshot.snapshotId,freezeSeq:snapshot.seq,pageCount:snapshot.pageCount};
  this.store.transaction(db=>{
   const key="$migration-plan-"+state.id,old=db.get("recovery",key);
   check(!old||p.encode(old).equals(p.encode(plan)),"MIGRATION_SOURCE_CHANGED");db.put("recovery",key,plan);
  });
  const {pageCount,...parameters}=plan;
  const status=this.validateStatus(await this.request(state.phase==="FROZEN"?"status":"prepare",state.phase==="FROZEN"?{migrationId:state.id}:parameters),plan,"FROZEN");
  if(state.phase==="PREPARING")this.journal.advance("PREPARING","FROZEN",{freezeSeq:plan.freezeSeq,sourceEpoch:plan.sourceEpoch,sourceSnapshotId:plan.sourceSnapshotId,sourcePageCount:pageCount,sourceObjectCount:status.objectCount,targetEpoch:status.targetEpoch});
  else check(state.evidence.targetEpoch===status.targetEpoch,"MIGRATION_EPOCH_CHANGED");
  return status;
 }
 async sourcePage(page){
  this.ready();const state=this.journal.get(),plan=this.plan();
  check(["FROZEN","UPLOADING","VERIFIED"].includes(state.phase)&&Number.isSafeInteger(page)&&page>=0&&page<plan.pageCount,"MIGRATION_PHASE_CONFLICT");
  const prefix="$migration-source-"+state.id+"-"+page,existing=this.store.get("recovery",prefix);
  if(existing){
   check(Number.isSafeInteger(existing.parts)&&existing.parts>0&&existing.parts<=16);
   const parts=[];for(let i=0;i<existing.parts;i++){const bytes=this.store.get("recovery",prefix+"-"+i);check(Buffer.isBuffer(bytes));parts.push(bytes);}
   const raw=Buffer.concat(parts);
   try{check(raw.length===existing.length&&createHash("sha256").update(raw).digest("hex")===existing.checksum,"MIGRATION_SOURCE_CORRUPT");return {payload:raw.toString("utf8"),checksum:existing.checksum};}
   finally{raw.fill(0);for(const bytes of parts)bytes.fill(0);}
  }
  const result=await this.request("source-page",{migrationId:state.id,page});
  check(typeof result?.payload==="string"&&/^[a-f0-9]{64}$/.test(result.checksum));
  const raw=Buffer.from(result.payload,"utf8");
  try{
   check(raw.length<=4*p.MAX_BYTES&&createHash("sha256").update(raw).digest("hex")===result.checksum,"MIGRATION_SOURCE_CORRUPT");
   this.store.transaction(db=>{
    check(p.encode(this.journal.get()).equals(p.encode(state)),"MIGRATION_CHANGED");
    const parts=Math.ceil(raw.length/(256*1024));check(parts>0);
    for(let i=0;i<parts;i++)db.put("recovery",prefix+"-"+i,raw.subarray(i*256*1024,(i+1)*256*1024));
    db.put("recovery",prefix,{parts,length:raw.length,checksum:result.checksum});
   });
   return result;
  }finally{raw.fill(0);}
 }
 async cancel(){
  this.ready();const state=this.journal.get(),plan=this.plan();
  check(state.phase!=="ACTIVE","MIGRATION_ALREADY_ACTIVE");
  check(["PREPARING","FROZEN","UPLOADING","VERIFIED","COMMITTING"].includes(state.phase),"MIGRATION_PHASE_CONFLICT");
  const remote=await this.request("status",{migrationId:state.id});
  if(remote.phase==="ACTIVE"){this.validateStatus(remote,plan,"ACTIVE");throw Error("MIGRATION_ALREADY_ACTIVE");}
  check(["FROZEN","UPLOADING","VERIFIED","CANCELLED"].includes(remote.phase),"MIGRATION_PHASE_CONFLICT");
  this.validateStatus(remote,plan,remote.phase);
  this.validateStatus(await this.request("cancel",{migrationId:state.id}),plan,"CANCELLED");
  return this.journal.confirmCancelled(async()=>{
   const result=await this.request("status",{migrationId:state.id});return this.validateStatus(result,plan,"CANCELLED");
  });
 }
}
module.exports={createMigrationRequest,MigrationSession};
