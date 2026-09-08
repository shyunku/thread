const p=require("./protocol");
function validDevice(device) {
 if (!device || typeof device.id!=="string" || !device.id || !["read","write"].includes(device.role) ||
     typeof device.canAuthorizeDevices!=="boolean" ||
     !Buffer.isBuffer(device.signingKey) || device.signingKey.length!==32 ||
     !Buffer.isBuffer(device.encryptionKey) || device.encryptionKey.length!==32) throw Error("INVALID_DEVICE");
}
async function verifyGenesis(record, expectedFingerprint) {
 const body=record.body;
 if(!body || body.schema!==1 || typeof body.vaultId!=="string" || !body.vaultId ||
    !Buffer.isBuffer(body.recoveryKey) || body.recoveryKey.length!==32) throw Error("INVALID_GENESIS");
 validDevice(body.owner);
 if(body.owner.role!=="write" || !body.owner.canAuthorizeDevices)throw Error("INVALID_GENESIS_OWNER");
 if(p.fingerprint(body)!==expectedFingerprint)throw Error("GENESIS_PIN_MISMATCH");
 await p.verify(body.owner.signingKey,"genesis",body,record.signature);
 return {vaultId:body.vaultId,revision:0,head:p.fingerprint(body),devices:new Map([[body.owner.id,body.owner]])};
}
async function applyMembership(state,record) {
 const event=record.body;
 if(event.vaultId!==state.vaultId || event.revision!==state.revision+1 || event.previous!==state.head)
   throw Error("MEMBERSHIP_CHAIN_MISMATCH");
 const signer=state.devices.get(event.signer);
 if(!signer?.canAuthorizeDevices)throw Error("DEVICE_APPROVAL_FORBIDDEN");
 await p.verify(signer.signingKey,"membership",event,record.signature);
 const devices=new Map(state.devices);
 if(event.operation==="add") {
  validDevice(event.device);
  if(devices.has(event.device.id))throw Error("DUPLICATE_DEVICE");
  devices.set(event.device.id,event.device);
 } else if(event.operation==="revoke") {
  if(!devices.delete(event.deviceId))throw Error("UNKNOWN_DEVICE");
 } else throw Error("INVALID_MEMBERSHIP_OPERATION");
 return {vaultId:state.vaultId,revision:event.revision,head:p.fingerprint(record),devices};
}
async function verifyMutation(state,record,lastCounter) {
 const body=record.body,device=state.devices.get(body.deviceId);
 if(!device || device.role!=="write")throw Error("DEVICE_WRITE_FORBIDDEN");
 if(body.vaultId!==state.vaultId || body.membershipRevision!==state.revision ||
   typeof body.counter!=="string" || !/^[1-9][0-9]{0,19}$/.test(body.counter) ||
   BigInt(body.counter)>18446744073709551615n || BigInt(body.counter)<=BigInt(lastCounter))
   throw Error("MUTATION_REPLAY_OR_MEMBERSHIP");
 await p.verify(device.signingKey,"mutation",body,record.signature);
 return body;
}
module.exports={verifyGenesis,applyMembership,verifyMutation};
