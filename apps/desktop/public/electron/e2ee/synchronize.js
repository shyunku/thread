const p=require("./protocol"),sync=require("./syncProtocol");
const {createReadRequest,fromWire}=require("./readProtocol");
function check(value){if(!value)throw Error("INVALID_SYNC_RESPONSE");}
// One main-process session per unlocked vault. No keys or plaintext leave this
// object except through the encrypted replica; closing cancels late responses.
class EncryptedSynchronizer {
 constructor({replica,history,device,deviceId,epoch,keyForGeneration,transport}){
  Object.assign(this,{replica,history,device,deviceId,epoch,keyForGeneration,transport});
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
   if(!page.more)return;
   check(this.history.current.revision>prior);
  }
  throw Error("MEMBERSHIP_HISTORY_LIMIT");
 }
 async pull(until="0"){
  let target=until;
  for(let count=0;count<10000;count++){
   const after=this.replica.status().cursor,page=await this.read("pull",{after,until:target});
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
   check(page.next===this.replica.status().cursor);
   if(!page.more){check(page.next===target);return;}
   check(page.changes.length>0&&page.next!==after);
  }
  throw Error("SYNC_PAGE_LIMIT");
 }
 async snapshot(){
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
  await this.replica.installSnapshot({snapshot,history:this.history,keyForGeneration:this.keyForGeneration,pages});this.ready();
 }
 async settle(record,receipt){
  sync.verifyReceipt(record,receipt);
  if(sync.decimal(receipt.seq)>sync.decimal(this.replica.status().cursor)){await this.pull(receipt.seq);return;}
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
 async runOnce(){
  await this.refreshMembership();await this.pull();
  for(const item of this.replica.pending()){
   this.ready();
   if(item.value.status==="conflict")continue;
   let record;
   try{record=await this.replica.prepare(item.id,await this.context());}
   catch(error){
    if(error.message==="WAITING_FOR_PREVIOUS_EDIT")continue;
    if(error.message==="LOCAL_BASE_CONFLICT"){this.replica.preserveConflict(item.id);continue;}
    throw error;
   }
   this.ready();
   let receipt;
   try{receipt=await this.transport.push(record,this.abort.signal);this.ready();}
   catch(error){
    this.ready();
    if(error.message==="OBJECT_CONFLICT"){this.replica.preserveConflict(item.id);continue;}
    // Unknown network/authority outcomes retain the exact signed bytes.
    throw error;
   }
   await this.settle(record,receipt);
  }
  return this.replica.status();
 }
}
module.exports={EncryptedSynchronizer};
