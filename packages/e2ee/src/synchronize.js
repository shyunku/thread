const p=require("./protocol"),sync=require("./syncProtocol");
const {createReadRequest,fromWire}=require("./readProtocol");
function check(value){if(!value)throw Error("INVALID_SYNC_RESPONSE");}
// Hash of the confirmed objects in id order: canonical CBOR [objectId, version,
// deleted], the same rows the server hashes for its state digest.
function localStateDigest(store){
 const hash=require("./platform").createHash("sha256");let count=0,rows;
 try{rows=require("./bucketCache").bucketRows(store,"confirmed",{pages:40000});}
 catch(error){if(error.message==="BUCKET_PAGE_LIMIT")throw Error("STATE_DIGEST_LIMIT");throw error;}
 for(const {id,value} of rows){if(id.startsWith("$"))continue;hash.update(p.encode([id,value.version,!!value.deleted]));count++;}
 return {digest:hash.digest("hex"),count};
}
const MAX_REBASE_PASSES=3;
// One main-process session per unlocked vault. No keys or plaintext leave this
// object except through the encrypted replica; closing cancels late responses.
class EncryptedSynchronizer {
 constructor({replica,history,device,deviceId,epoch,keyForGeneration,transport,refreshKeys}){
  Object.assign(this,{replica,history,device,deviceId,epoch,keyForGeneration,transport,refreshKeys});
  this.abort=new AbortController();this.running=null;
 }
 ready(){if(this.abort.signal.aborted)throw Error("SYNC_CANCELLED");}
 close(){this.abort.abort();}
 async context(state=this.history.current){
  this.ready();const key=await this.keyForGeneration(state.keyGeneration);this.ready();
  return {state,device:this.device,deviceId:this.deviceId,epoch:this.epoch,key};
 }
 async read(operation,parameters){
  this.ready();
  const record=await createReadRequest({state:this.history.current,device:this.device,deviceId:this.deviceId,epoch:this.epoch,operation,parameters});
  this.ready();
  const method={"snapshot-page":"snapshotPage"}[operation]||operation;
  const result=await this.transport[method](record,this.abort.signal);this.ready();return result;
 }
 async refreshMembership(){
  for(let count=0;count<4096;count++){
   this.ready();const page=await this.transport.membership(this.history.current.revision,this.abort.signal);this.ready();
   check(fromWire(page.genesis).equals(p.encode(this.history.genesis)));
   const prior=this.history.current.revision;
   await this.history.appendPage(page);this.ready();
   if(!page.more){await this.refreshKeys?.(this.history);this.ready();return;}
   check(this.history.current.revision>prior);
  }
  throw Error("MEMBERSHIP_HISTORY_LIMIT");
 }
 async pull(until="0"){
  let target=until;
  for(let count=0;count<10000;count++){
   const after=this.replica.cursor(),page=await this.read("pull",{after,until:target});
   check(Array.isArray(page.changes)&&page.changes.length<=32&&typeof page.more==="boolean");
   sync.decimal(page.until);sync.decimal(page.next);
   check(sync.decimal(page.until)>=sync.decimal(after));
   if(target==="0")target=page.until;else check(page.until===target);
   check(sync.decimal(page.next)<=sync.decimal(target));
   for(const change of page.changes){
    this.ready();const record=p.decode(fromWire(change.record));
    const context=await this.context(this.history.at(record.body.membershipRevision));
    check(record.body.keyGeneration===context.state.keyGeneration);
    check(sync.decimal(change.result.seq)<=sync.decimal(target));
    await this.replica.applyChange({record,result:change.result},context);this.ready();
   }
   check(page.next===this.replica.cursor());
   if(!page.more){check(page.next===target);return;}
   check(page.changes.length>0&&page.next!==after);
  }
  throw Error("SYNC_PAGE_LIMIT");
 }
 async snapshot(migrationJournal=null){
  await this.refreshMembership();
  const snapshot=await this.read("snapshot",{}),self=this;
  const pages=(async function*(){
   let after="";
   for(let count=0;count<40000;count++){
    const page=await self.read("snapshot-page",{snapshotId:snapshot.id,after});yield page;
    if(!page.more)return;
    check(page.next!==after);after=page.next;
   }
   throw Error("SYNC_PAGE_LIMIT");
  })();
  await this.replica.installSnapshot({snapshot,history:this.history,keyForGeneration:this.keyForGeneration,pages,migrationJournal});this.ready();
 }
 // After pulling changes instead of a snapshot (#98): compare the confirmed local
 // objects with the server's current object list. true = same, false = differ
 // (the caller restores from a snapshot), null = could not compare this time
 // (older server, membership moved, temporary error).
 async verifyState(){
  let digest;
  try{digest=await this.read("digest",{});}
  catch(error){
   this.ready();
   if(["DEVICE_FORBIDDEN","UNAUTHORIZED","AUTH_REQUIRED","UPDATE_REQUIRED","E2EE_NOT_ACTIVE"].includes(error.message))throw error;
   return null;
  }
  this.ready();
  check(digest&&digest.epoch===this.epoch&&/^[a-f0-9]{64}$/.test(digest.digest)&&Number.isSafeInteger(digest.count)&&digest.count>=0);
  if(digest.membershipHead!==this.history.current.head)return null;
  const cursor=sync.decimal(this.replica.cursor()),seq=sync.decimal(digest.seq);
  if(seq<cursor)return null;
  if(seq>cursor){await this.pull(digest.seq);this.ready();}
  if(sync.decimal(this.replica.cursor())!==seq)return null;
  const local=localStateDigest(this.replica.store);
  return local.count===digest.count&&local.digest===digest.digest;
 }
 async settle(record,receipt){
  sync.verifyReceipt(record,receipt);
  if(sync.decimal(receipt.seq)>sync.decimal(this.replica.cursor())){await this.pull(receipt.seq);return;}
  // A restored snapshot can be ahead of an unknown ACK. Fetch and verify the
  // original accepted mutation, never remove an outbox item on JSON ACK alone.
  const page=await this.read("pull",{after:(sync.decimal(receipt.seq,true)-1n).toString(),until:receipt.seq});
  check(page.changes?.length===1&&page.more===false&&page.until===receipt.seq&&page.next===receipt.seq);
  const accepted=page.changes[0],original=p.decode(fromWire(accepted.record));
  check(p.encode(original).equals(p.encode(record))&&accepted.result.seq===receipt.seq);
  await this.replica.acknowledgeSnapshot({record:original,result:accepted.result},await this.context(this.history.at(original.body.membershipRevision)));
 }
 run(){
  if(this.running)return this.running;
  this.running=this.runOnce().finally(()=>{this.running=null;});return this.running;
 }
 reconcile(id){
  if(this.running)return Promise.reject(Error("SYNC_BUSY"));
  this.running=this.reconcileOnce(id).finally(()=>{this.running=null;});return this.running;
 }
 async reconcileOnce(id){
  this.ready();
  if(typeof id!=="string"||!/^[a-f0-9]{32}$/.test(id))throw Error("INVALID_RECONCILIATION");
  const draft=this.replica.store.get("outbox",id);
  if(!draft?.record)throw Error("SIGNED_REQUEST_REQUIRED");
  const record=p.decode(draft.record);
  check(record.body.mutationId===id&&record.body.deviceId===this.deviceId&&record.body.epoch===this.epoch);
  await this.refreshMembership();await this.pull();this.ready();
  if(!this.replica.store.get("outbox",id))return {phase:"APPLIED"};
  check(this.replica.store.get("outbox",id).record?.equals(draft.record));
  let receipt;
  try{receipt=await this.transport.push(record,this.abort.signal);this.ready();}
  catch(error){
   this.ready();
   if(["OBJECT_CONFLICT","SYNC_CHECKPOINT_CONFLICT"].includes(error.message))return {phase:"REVIEW_REQUIRED"};
   throw error;
  }
  await this.settle(record,receipt);this.ready();
  check(!this.replica.store.get("outbox",id));
  return {phase:"APPLIED"};
 }
 async runOnce(){
  await this.refreshMembership();
  // Each automatic rebase restarts from a fresh pull; repeated conflicts wait for the next run.
  for(let pass=0;;pass++){
   await this.pull();
   if(!await this.pushPending(pass<MAX_REBASE_PASSES))return this.replica.status();
  }
 }
 // Returns true when a draft was rebased and the caller should pull and push again.
 async pushPending(canRebase){
  if(canRebase){
   const held=this.replica.pending().filter(row=>row.value.status==="conflict"&&row.value.reviewReason==="OBJECT_CONFLICT"&&!row.value.autoRebaseFailed);
   for(const row of held)this.rebaseOrHold(row.id,true);
   if(held.length)return true;
  }
  // Accepted pushes are settled in groups (one pull for up to 32 receipts, one pull page)
  // instead of a pull after every push (#98). A draft that touches an object of an
  // unsettled push waits for the group: its base is that push's result. Anything left
  // unsettled after an error is settled by the next run's pull (exact signed bytes).
  const unsettled=[];
  const flush=async()=>{
   if(!unsettled.length)return;
   const group=unsettled.splice(0);
   const last=group.reduce((max,{receipt})=>sync.decimal(receipt.seq)>max?sync.decimal(receipt.seq):max,0n);
   if(last>sync.decimal(this.replica.cursor()))await this.pull(last.toString());
   for(const {record,receipt} of group)if(this.replica.store.get("outbox",record.body.mutationId))await this.settle(record,receipt);
   this.ready();
  };
  const touches=item=>unsettled.some(({record})=>record.body.operations.some(op=>item.value.changes.some(c=>c.objectId===op.objectId)));
  for(const item of this.replica.pending()){
   this.ready();
   if(item.value.status==="conflict")continue;
   if(!this.replica.store.get("outbox",item.id))continue;
   if(unsettled.length>=32||touches(item))await flush();
   let record;
   try{record=await this.replica.prepare(item.id,await this.context());}
   catch(error){
    if(error.message==="WAITING_FOR_PREVIOUS_EDIT")continue;
    if(error.message==="LOCAL_BASE_CONFLICT"){await flush();if(!canRebase)return false;this.rebaseOrHold(item.id);return true;}
    throw error;
   }
   this.ready();
   let receipt;
   try{receipt=await this.transport.push(record,this.abort.signal);this.ready();}
   catch(error){
    this.ready();
    // The server checks the mutation ID before object versions, so OBJECT_CONFLICT means
    // this request was not accepted and a rebased request cannot duplicate it.
    if(error.message==="OBJECT_CONFLICT"){await flush();if(!canRebase)return false;this.rebaseOrHold(item.id);return true;}
    // Retry exact bytes first: an accepted old request returns its original receipt.
    // A stale rejection is NOT proof of non-acceptance; retain it for review.
    if(error.message==="SYNC_CHECKPOINT_CONFLICT"&&record.body.epoch===this.epoch&&
     (record.body.membershipRevision<this.history.current.revision||record.body.keyGeneration<this.history.current.keyGeneration)){
     this.replica.preserveConflict(item.id,"STALE_SIGNED_REQUEST");continue;
    }
    // Unknown network/authority outcomes retain the exact signed bytes.
    throw error;
   }
   sync.verifyReceipt(record,receipt);
   unsettled.push({record,receipt});
  }
  await flush();
  return false;
 }
 // Falls back to manual review only when the draft cannot be rebased safely.
 rebaseOrHold(id,held=false){
  try{this.replica.rebase(id);}
  catch{
   if(held)this.replica.store.transaction(db=>{const draft=db.get("outbox",id);if(draft)db.put("outbox",id,{...draft,autoRebaseFailed:true});});
   else this.replica.preserveConflict(id);
  }
 }
}
module.exports={EncryptedSynchronizer,localStateDigest};
