const {randomBytes,createHash}=require("node:crypto");
const p=require("./protocol"),sync=require("./syncProtocol");
const {createReadRequest,SnapshotVerifier}=require("./readProtocol");
function check(ok,code="MIGRATION_READBACK_FAILED"){if(!ok)throw Error(code);}
function sourceRows(payload){
 let value;try{value=JSON.parse(payload);}catch{throw Error("MIGRATION_SOURCE_INVALID");}
 check(value&&Object.keys(value).length===1&&(value.changes===null||Array.isArray(value.changes)),"MIGRATION_SOURCE_INVALID");
 const rows=value.changes||[];
 for(const row of rows){
  check(row&&["task","category","subtask","taskCategory"].includes(row.entityType)&&typeof row.entityId==="string"&&row.entityId.length>0&&row.entityId.length<=255&&
   ["upsert","delete"].includes(row.operation)&&row.fields&&Object.getPrototypeOf(row.fields)===Object.prototype&&
   Object.keys(row).every(k=>["entityType","entityId","parentId","operation","version","fields"].includes(k)),"MIGRATION_SOURCE_INVALID");
  if(["subtask","taskCategory"].includes(row.entityType))check(typeof row.parentId==="string"&&row.parentId.length>0&&row.parentId.length<=255,"MIGRATION_SOURCE_INVALID");
  sync.decimal(row.version,true);
  check(p.encode(row).length<=700*1024,"MIGRATION_OBJECT_TOO_LARGE");
 }
 return rows;
}
// Durable stage -> decrypt/readback -> attestation -> commit/status.
// Caller must have explicitly prepared this account. No DB deletion/cutover.
class MigrationTransfer{
 constructor({session,keyForGeneration}){this.session=session;this.keyForGeneration=keyForGeneration;this.running=null;}
 run(){if(this.running)return this.running;this.running=this.execute().finally(()=>{this.running=null;});return this.running;}
 async read(operation,parameters){
  const s=this.session;s.ready();
  const proof=await createReadRequest({state:s.history.current,device:s.device,deviceId:s.deviceId,epoch:s.epoch,operation,parameters});
  s.ready();const method=operation==="migration-snapshot"?"migrationSnapshot":"migrationSnapshotPage";
  const result=await s.transport[method](proof,s.abort.signal);s.ready();return result;
 }
 mapped(row,page,index){
  const s=this.session,id=s.journal.get().id;
  const identity=createHash("sha256").update(p.encode([row.entityType,row.parentId||"",row.entityId])).digest("hex");
  return s.store.transaction(db=>{
   const key="$migration-object-"+id+"-"+identity,old=db.get("recovery",key);
   if(old){check(old.page===page&&old.index===index&&p.encode(old.row).equals(p.encode(row)),"MIGRATION_SOURCE_CHANGED");return old.objectId;}
   const objectId=randomBytes(16).toString("hex"),record={objectId,page,index,row};
   db.put("recovery",key,record);db.put("recovery","$migration-expected-"+id+"-"+objectId,record);return objectId;
  });
 }
 async batch(page,part,changes){
  const s=this.session,id=s.journal.get().id,key="$migration-upload-"+id+"-"+page+"-"+part;
  let raw=s.store.get("recovery",key);
  if(!raw){
   const counter=s.store.transaction(db=>{
    const name="$migration-counter-"+s.deviceId,previous=db.get("recovery",name)||"0",next=(sync.decimal(previous)+1n).toString();sync.decimal(next,true);db.put("recovery",name,next);return next;
   });
   const state=s.history.current,dataKey=await this.keyForGeneration(state.keyGeneration);s.ready();
   const record=await sync.createBatch({state,device:s.device,deviceId:s.deviceId,epoch:s.epoch,key:dataKey,counter,mutationId:randomBytes(16).toString("hex"),changes,schema:2});s.ready();
   const encoded=p.encode(record);
   raw=s.store.transaction(db=>{const old=db.get("recovery",key);if(old)return old;db.put("recovery",key,encoded);return encoded;});
  }
  const record=p.decode(raw);
  // Reuse the original signed bytes even after an unknown upload response.
  check(record.body.operations.length===changes.length&&record.body.operations.every((op,i)=>op.objectId===changes[i].objectId&&op.deleted===changes[i].deleted),"MIGRATION_BATCH_CHANGED");
  s.ready();const result=await s.transport.migrationPush(record,s.abort.signal);s.ready();sync.verifyReceipt(record,result);return raw;
 }
 async upload(){
  const s=this.session,plan=s.plan();let count=0;
  // Validate/cache every source row before sending the first mutation. A bad
  // or oversized later page must not leave a partially uploaded attempt.
  for(let page=0;page<plan.pageCount;page++){
   const rows=sourceRows((await s.sourcePage(page)).payload);
   for(let index=0;index<rows.length;index++){this.mapped(rows[index],page,index);count++;}
  }
  check(count===s.journal.get().evidence.sourceObjectCount,"MIGRATION_SOURCE_COUNT");
  for(let page=0;page<plan.pageCount;page++){
   const source=await s.sourcePage(page),rows=sourceRows(source.payload),hash=createHash("sha256");let changes=[],size=0,part=0;
   const flush=async()=>{if(!changes.length)return;hash.update(await this.batch(page,part++,changes));changes=[];size=0;};
   for(let index=0;index<rows.length;index++){
    const row=rows[index],bytes=p.encode(row).length+1024;
    if(changes.length>=100||size+bytes>800*1024)await flush();
    changes.push({objectId:this.mapped(row,page,index),baseVersion:"0",deleted:row.operation==="delete",fields:[{slot:0,value:row}]});size+=bytes;
   }
   await flush();s.journal.checkpoint(page,hash.digest("hex"));
  }
  check(count===s.journal.get().evidence.sourceObjectCount,"MIGRATION_SOURCE_COUNT");return count;
 }
 async verify(count){
  const s=this.session,state=s.journal.get(),plan=s.plan(),snapshot=await this.read("migration-snapshot",{});
  check(snapshot.count===count,"MIGRATION_SOURCE_COUNT");
  const verifier=new SnapshotVerifier({snapshot,history:s.history,epoch:s.epoch,keyForGeneration:this.keyForGeneration,stage:async object=>{
   const expected=s.store.get("recovery","$migration-expected-"+state.id+"-"+object.objectId);
   check(expected&&object.version==="1"&&object.deleted===(expected.row.operation==="delete")&&object.fields.length===1&&object.fields[0].slot===0&&p.encode(object.fields[0].value).equals(p.encode(expected.row)));
  }});
  let after="";
  for(let pages=0;pages<40000;pages++){
   const page=await this.read("migration-snapshot-page",{snapshotId:snapshot.id,after});await verifier.addPage(page);s.ready();
   if(!page.more)break;after=page.next;
  }
  const checkpoint=verifier.finish();
  const response=await s.request("verify",{migrationId:state.id,snapshotId:snapshot.id,freezeSeq:plan.freezeSeq,ciphertextManifest:snapshot.digest,sourcePageCount:plan.pageCount,sourceObjectCount:count});
  s.validateStatus(response,plan,"VERIFIED");check(response.ciphertextManifest===snapshot.digest);
  s.store.put("recovery","$migration-readback-"+state.id,{snapshot,checkpoint});
  s.journal.advance("UPLOADING","VERIFIED",{ciphertextManifest:snapshot.digest,readbackMatches:true,allPagesVerified:true});
 }
 async execute(){
  const s=this.session;s.ready();let state=s.journal.get();check(state,"MIGRATION_NOT_STARTED");
  if(state.phase==="ACTIVE")return state;
  check(["FROZEN","UPLOADING","VERIFIED","COMMITTING"].includes(state.phase),"MIGRATION_PHASE_CONFLICT");
  s.epoch=state.evidence.targetEpoch;
  if(state.phase==="FROZEN")state=s.journal.advance("FROZEN","UPLOADING",{});
  if(state.phase==="UPLOADING"){await this.verify(await this.upload());state=s.journal.get();}
  if(state.phase==="VERIFIED")state=s.journal.advance("VERIFIED","COMMITTING",{});
  const plan=s.plan();let remote=await s.request("status",{migrationId:state.id});
  if(remote.phase==="VERIFIED"){
   s.validateStatus(remote,plan,"VERIFIED");check(remote.ciphertextManifest===state.evidence.ciphertextManifest);
   await s.request("commit",{migrationId:state.id,freezeSeq:plan.freezeSeq,ciphertextManifest:state.evidence.ciphertextManifest,targetEpoch:s.epoch});
   remote=await s.request("status",{migrationId:state.id});
  }
  s.validateStatus(remote,plan,"ACTIVE");check(remote.targetEpoch===s.epoch);
  return s.journal.confirmCommitted(async()=>remote);
 }
}
module.exports={MigrationTransfer,sourceRows};
