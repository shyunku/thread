const p=require("./protocol"),m=require("./membership");
const id=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function check(value){if(!value)throw Error("INVALID_ENCRYPTED_BATCH");}
function decimal(value,positive=false){check(typeof value==="string"&&/^(0|[1-9][0-9]{0,19})$/.test(value));const n=BigInt(value);check(n<=18446744073709551615n&&(!positive||n>0n));return n;}
function validateBody(b){
 check(b&&Object.keys(b).length===9&&b.schema===1&&id(b.vaultId)&&id(b.deviceId)&&id(b.mutationId)&&typeof b.epoch==="string"&&b.epoch.length>0&&b.epoch.length<=128);
 check(Number.isSafeInteger(b.membershipRevision)&&b.membershipRevision>=0&&Number.isSafeInteger(b.keyGeneration)&&b.keyGeneration>=1);decimal(b.counter,true);
 check(Array.isArray(b.operations)&&b.operations.length>0&&b.operations.length<=100);const objects=new Set();
 for(const op of b.operations){check(op&&Object.keys(op).length===4&&id(op.objectId)&&!objects.has(op.objectId)&&typeof op.deleted==="boolean");objects.add(op.objectId);check(decimal(op.baseVersion)<18446744073709551615n);
  check(Array.isArray(op.fields)&&op.fields.length<=256&&(op.deleted?op.fields.length===0:op.fields.length>0));const slots=new Set();
  for(const f of op.fields){check(f&&Object.keys(f).length===3&&Number.isSafeInteger(f.slot)&&f.slot>=0&&!slots.has(f.slot)&&Buffer.isBuffer(f.nonce)&&f.nonce.length===24&&Buffer.isBuffer(f.ciphertext)&&f.ciphertext.length>=16);slots.add(f.slot);}
 }
 return b;
}
function context(body,op,slot){return {vaultId:body.vaultId,vaultEpoch:body.epoch,objectId:op.objectId,fieldSlot:slot,keyGeneration:body.keyGeneration,mutationId:body.mutationId,deviceId:body.deviceId};}
async function createBatch({state,epoch,deviceId,device,counter,mutationId,key,changes}){
 const d=state.devices.get(deviceId);check(d?.role==="write"&&d.signingKey.equals(device.signing.publicKey));
 const body={schema:1,vaultId:state.vaultId,epoch,deviceId,membershipRevision:state.revision,keyGeneration:state.keyGeneration,counter,mutationId,operations:[]};
 check(Array.isArray(changes)&&changes.length>0&&changes.length<=100);
 for(const change of changes){const op={objectId:change.objectId,baseVersion:change.baseVersion,deleted:change.deleted,fields:[]};
  check(Array.isArray(change.fields)&&change.fields.length<=256&&(!change.deleted||change.fields.length===0));
  for(const field of change.fields){const encrypted=await p.encrypt(key,context(body,op,field.slot),field.value);op.fields.push({slot:field.slot,...encrypted});}
  body.operations.push(op);
 }
 validateBody(body);const record={body,signature:await p.sign(device.signing.privateKey,"mutation",body)};p.encode(record);return record;
}
async function verifyBatch(record,{state,epoch,lastCounter="0"}){
 check(record&&Object.keys(record).length===2);p.encode(record);
 validateBody(record.body);check(record.body.epoch===epoch&&record.body.keyGeneration===state.keyGeneration);
 await m.verifyMutation(state,record,lastCounter);return record.body;
}
async function decryptBatch(record,{state,epoch,lastCounter="0",key}){
 const body=await verifyBatch(record,{state,epoch,lastCounter}),objects=[];
 for(const op of body.operations){const fields=[];for(const f of op.fields){fields.push({slot:f.slot,value:await p.decrypt(key,context(body,op,f.slot),f)});}
  objects.push({objectId:op.objectId,baseVersion:op.baseVersion,version:(decimal(op.baseVersion)+1n).toString(),deleted:op.deleted,fields});
 }
 return objects;
}
function verifyReceipt(record,receipt){
 validateBody(record.body);check(receipt&&receipt.versions&&Object.keys(receipt.versions).length===record.body.operations.length);decimal(receipt.seq,true);
 for(const op of record.body.operations)check(receipt.versions[op.objectId]===(decimal(op.baseVersion)+1n).toString());return receipt;
}
module.exports={createBatch,verifyBatch,decryptBatch,verifyReceipt,decimal};
