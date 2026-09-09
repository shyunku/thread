const {randomBytes,createHash}=require("node:crypto");
const p=require("./protocol"),m=require("./membership"),sync=require("./syncProtocol");
const id=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function check(value,code="INVALID_SYNC_READ"){if(!value)throw Error(code);}
function fromWire(value){
 check(typeof value==="string"&&value.length<=Math.ceil(p.MAX_BYTES/3)*4,"INVALID_SIGNED_RECORD");
 const raw=Buffer.from(value,"base64");check(raw.toString("base64")===value,"INVALID_SIGNED_RECORD");return raw;
}
async function createReadRequest({state,epoch,deviceId,device,operation,parameters,now=Date.now()}){
 const approved=state.devices.get(deviceId);
 check(approved&&approved.signingKey.equals(device.signing.publicKey),"DEVICE_FORBIDDEN");
 check(id(epoch)&&Number.isSafeInteger(now)&&now>=0&&parameters&&Object.getPrototypeOf(parameters)===Object.prototype);
 if(operation==="pull"){check(Object.keys(parameters).length===2);sync.decimal(parameters.after);sync.decimal(parameters.until);}
 else if(operation==="snapshot"||operation==="migration-snapshot")check(Object.keys(parameters).length===0);
 else if(operation==="envelope")check(Object.keys(parameters).length===1&&Number.isSafeInteger(parameters.keyGeneration)&&parameters.keyGeneration>=1&&parameters.keyGeneration<=state.keyGeneration);
 else if(operation==="snapshot-page"||operation==="migration-snapshot-page")check(Object.keys(parameters).length===2&&typeof parameters.snapshotId==="string"&&parameters.snapshotId.length===36&&(parameters.after===""||id(parameters.after)));
 else throw Error("INVALID_SYNC_READ");
 const body={schema:1,vaultId:state.vaultId,deviceId,epoch,membershipRevision:state.revision,keyGeneration:state.keyGeneration,operation,parameters,requestId:randomBytes(16).toString("hex"),expiresAt:now+60000};
 return {body,signature:await p.sign(device.signing.privateKey,"request",body)};
}
class MembershipHistory {
 constructor(genesis,pin){this.genesis=genesis;this.pin=pin;this.states=new Map();}
 async initialize(){this.current=await m.verifyGenesis(this.genesis,this.pin);this.states.set(0,this.current);return this;}
 at(revision){const state=this.states.get(revision);check(state,"MEMBERSHIP_HISTORY_MISSING");return state;}
 async append(record){
  check(this.current&&this.states.size<4096,"MEMBERSHIP_HISTORY_LIMIT");
  const next=record.body.schema===1&&record.body.envelopes?await m.applyTransition(this.current,record):
   record.body.operation==="recover"?await m.applyRecovery(this.current,record):await m.applyMembership(this.current,record);
  this.states.set(next.revision,next);this.current=next;return next;
 }
 async appendPage(page){
  check(page&&page.head?.vaultId===this.current.vaultId&&Number.isSafeInteger(page.next)&&Array.isArray(page.records)&&page.records.length<=128);
  for(const raw of page.records)await this.append(p.decode(fromWire(raw)));
  check(page.next===this.current.revision&&typeof page.more==="boolean");
  if(!page.more)check(page.head.revision===this.current.revision&&page.head.digest===this.current.head,"MEMBERSHIP_HEAD_MISMATCH");
  return this.current;
 }
}
class SnapshotVerifier {
 constructor({snapshot,history,epoch,minimumSeq="0",keyForGeneration,stage}){
  check(snapshot&&id(epoch)&&snapshot.epoch===epoch&&typeof snapshot.id==="string"&&snapshot.id.length===36);
  check(/^[a-f0-9]{64}$/.test(snapshot.digest)&&snapshot.membershipHead===history.current.head,"SNAPSHOT_HEAD_MISMATCH");
  check(Number.isSafeInteger(snapshot.count)&&snapshot.count>=0&&snapshot.count<=1000000&&sync.decimal(snapshot.seq)>=sync.decimal(minimumSeq),"SNAPSHOT_ROLLBACK");
  this.snapshot=snapshot;this.history=history;this.epoch=epoch;this.keyForGeneration=keyForGeneration;this.stage=stage;
  this.hash=createHash("sha256");this.count=0;this.last="";this.ended=false;this.counters=new Map();
 }
 async addPage(page){
  check(!this.ended&&page&&Array.isArray(page.objects)&&page.objects.length<=32&&typeof page.more==="boolean");
  let bytes=0;
  for(const object of page.objects){
   check(id(object.objectId)&&object.objectId>this.last&&Number.isSafeInteger(object.operationIndex)&&object.operationIndex>=0,"SNAPSHOT_ORDER");
   const raw=fromWire(object.record);bytes+=raw.length;check(bytes<=4*p.MAX_BYTES,"SNAPSHOT_PAGE_SIZE");
   const record=p.decode(raw),state=this.history.at(record.body.membershipRevision);
   const key=await this.keyForGeneration(record.body.keyGeneration);
   const objects=await sync.decryptBatch(record,{state,epoch:this.epoch,key,lastCounter:"0"});
   const value=objects[object.operationIndex];
   check(value&&value.objectId===object.objectId&&value.version===object.version&&value.deleted===object.deleted,"SNAPSHOT_PROVENANCE");
   check(sync.decimal(object.seq,true)<=sync.decimal(this.snapshot.seq),"SNAPSHOT_SEQUENCE");
   this.hash.update(p.encode([object.objectId,object.version,object.seq,object.deleted,object.operationIndex,createHash("sha256").update(raw).digest()]));
   const counter=sync.decimal(record.body.counter,true),prior=this.counters.get(record.body.deviceId)||0n;
   this.counters.set(record.body.deviceId,counter>prior?counter:prior);
   await this.stage(value);
   this.last=object.objectId;this.count++;check(this.count<=this.snapshot.count,"SNAPSHOT_COUNT");
  }
  check(page.next===this.last&&(!page.more||page.objects.length>0),"SNAPSHOT_PAGE_CURSOR");
  this.ended=!page.more;
 }
 finish(){
  check(this.ended&&this.count===this.snapshot.count,"SNAPSHOT_INCOMPLETE");
  check(this.hash.digest("hex")===this.snapshot.digest,"SNAPSHOT_DIGEST");
  return {cursor:this.snapshot.seq,deviceCounters:[...this.counters].map(([deviceId,counter])=>({deviceId,counter:counter.toString()}))};
 }
}
module.exports={createReadRequest,MembershipHistory,SnapshotVerifier,fromWire};
