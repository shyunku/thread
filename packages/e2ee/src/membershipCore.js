const {Buffer}=require("buffer");
function createMembership(p) {
function validDevice(device) {
 if (!device || Object.keys(device).length!==5 || typeof device.id!=="string" || !/^[A-Za-z0-9_-]{1,128}$/.test(device.id) || !["read","write"].includes(device.role) ||
     typeof device.canAuthorizeDevices!=="boolean" ||
     !Buffer.isBuffer(device.signingKey) || device.signingKey.length!==32 ||
     !Buffer.isBuffer(device.encryptionKey) || device.encryptionKey.length!==32) throw Error("INVALID_DEVICE");
}
async function verifyGenesis(record, expectedFingerprint) {
 if(!record||Object.keys(record).length!==2)throw Error("INVALID_GENESIS");
 const body=record.body;
 if(!body || Object.keys(body).length!==4 || body.schema!==1 || typeof body.vaultId!=="string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.vaultId) ||
    !Buffer.isBuffer(body.recoveryKey) || body.recoveryKey.length!==32) throw Error("INVALID_GENESIS");
 validDevice(body.owner);
 if(body.owner.role!=="write" || !body.owner.canAuthorizeDevices)throw Error("INVALID_GENESIS_OWNER");
 if(p.fingerprint(body)!==expectedFingerprint)throw Error("GENESIS_PIN_MISMATCH");
 await p.verify(body.owner.signingKey,"genesis",body,record.signature);
 return {vaultId:body.vaultId,genesisFingerprint:expectedFingerprint,recoveryKey:body.recoveryKey,keyGeneration:1,revision:0,head:p.fingerprint(body),devices:new Map([[body.owner.id,body.owner]]),usedIds:new Set([body.owner.id]),usedSigningKeys:new Set([body.owner.signingKey.toString("hex")])};
}
async function applyMembership(state,record) {
 const event=record.body;
 if(![6,8].includes(Object.keys(event).length) || !Number.isSafeInteger(event.revision) || event.revision<1 || event.vaultId!==state.vaultId || event.revision!==state.revision+1 || event.previous!==state.head)
   throw Error("MEMBERSHIP_CHAIN_MISMATCH");
 // Historical records remain verifiable after expiry. Only the server applies
 // fresh approvals; current write requests always carry signed expiry/request ID.
 if(Object.keys(event).length===8&&(!Number.isSafeInteger(event.expiresAt)||event.expiresAt<=0||typeof event.requestId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(event.requestId)))throw Error("INVALID_MEMBERSHIP_EXPIRY");
 const signer=state.devices.get(event.signer);
 if(!signer?.canAuthorizeDevices)throw Error("DEVICE_APPROVAL_FORBIDDEN");
 await p.verify(signer.signingKey,"membership",event,record.signature);
 const devices=new Map(state.devices);
 const usedIds=new Set(state.usedIds),usedSigningKeys=new Set(state.usedSigningKeys);
 if(event.operation==="add") {
  validDevice(event.device);
  if(usedIds.has(event.device.id)||usedSigningKeys.has(event.device.signingKey.toString("hex")))throw Error("DUPLICATE_DEVICE");
  devices.set(event.device.id,event.device);
  usedIds.add(event.device.id);usedSigningKeys.add(event.device.signingKey.toString("hex"));
 } else if(event.operation==="revoke") {
  if(!devices.delete(event.deviceId))throw Error("UNKNOWN_DEVICE");
  if(![...devices.values()].some(d=>d.canAuthorizeDevices))throw Error("LAST_AUTHORITY_REQUIRED");
 } else throw Error("INVALID_MEMBERSHIP_OPERATION");
 return {...state,revision:event.revision,head:p.fingerprint(record),devices,usedIds,usedSigningKeys};
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
async function applyRecovery(state,record){
 const b=record.body;
 if(!b||Object.keys(b).length!==7||b.operation!=="recover"||b.vaultId!==state.vaultId||!Number.isSafeInteger(b.revision)||b.revision!==state.revision+1||b.previous!==state.head||!Number.isSafeInteger(b.keyGeneration)||b.keyGeneration!==state.keyGeneration+1||!Buffer.isBuffer(b.recoveryKey)||b.recoveryKey.length!==32||b.recoveryKey.equals(state.recoveryKey)||!Array.isArray(b.devices)||b.devices.length<1||b.devices.length>32)throw Error("INVALID_RECOVERY_EVENT");
 await p.verify(state.recoveryKey,"recovery",b,record.signature);
 const devices=new Map(),usedIds=new Set(state.usedIds),usedSigningKeys=new Set(state.usedSigningKeys);
 for(const device of b.devices){validDevice(device);const key=device.signingKey.toString("hex");if(usedIds.has(device.id)||usedSigningKeys.has(key))throw Error("DUPLICATE_DEVICE");usedIds.add(device.id);usedSigningKeys.add(key);devices.set(device.id,device);}
 if(![...devices.values()].some(d=>d.canAuthorizeDevices))throw Error("LAST_AUTHORITY_REQUIRED");
 return {...state,revision:b.revision,head:p.fingerprint(record),keyGeneration:b.keyGeneration,recoveryKey:b.recoveryKey,devices,usedIds,usedSigningKeys};
}

async function applyTransition(state,record){
 const b=record.body;
 if(!b||Object.keys(record).length!==2||Object.keys(b).length!==11||b.schema!==1||
  !["rotate","recover"].includes(b.operation)||b.vaultId!==state.vaultId||b.previous!==state.head||
  !Number.isSafeInteger(b.revision)||b.revision!==state.revision+1||
  !Number.isSafeInteger(b.keyGeneration)||b.keyGeneration!==state.keyGeneration+1||
  !Buffer.isBuffer(b.recoveryKey)||b.recoveryKey.length!==32||b.recoveryKey.equals(state.recoveryKey)||
  !Buffer.isBuffer(b.recoveryEnvelope)||b.recoveryEnvelope.length<48||
  !Array.isArray(b.devices)||b.devices.length<1||b.devices.length>32||
  !Array.isArray(b.envelopes)||b.envelopes.length!==b.devices.length)throw Error("INVALID_KEY_TRANSITION");
 p.encode(record);
 if(b.operation==="rotate"){
  const signer=state.devices.get(b.signer);if(!signer?.canAuthorizeDevices)throw Error("DEVICE_APPROVAL_FORBIDDEN");
  await p.verify(signer.signingKey,"membership-transition",b,record.signature);
 }else{
  if(b.signer!==null)throw Error("INVALID_KEY_TRANSITION");
  await p.verify(state.recoveryKey,"recovery-transition",b,record.signature);
 }
 const devices=new Map(),keys=new Set(),usedIds=new Set(state.usedIds),usedSigningKeys=new Set(state.usedSigningKeys);
 for(const device of b.devices){
  validDevice(device);const key=device.signingKey.toString("hex"),old=state.devices.get(device.id);
  if(devices.has(device.id)||keys.has(key))throw Error("DUPLICATE_DEVICE");
  if(old){
   if(b.operation==="recover"||!old.signingKey.equals(device.signingKey)||!old.encryptionKey.equals(device.encryptionKey))throw Error("DEVICE_KEY_REUSE");
  }else if(usedIds.has(device.id)||usedSigningKeys.has(key))throw Error("DEVICE_KEY_REUSE");
  devices.set(device.id,device);keys.add(key);usedIds.add(device.id);usedSigningKeys.add(key);
 }
 if(![...devices.values()].some(d=>d.canAuthorizeDevices))throw Error("LAST_AUTHORITY_REQUIRED");
 const recipients=new Set();
 for(const envelope of b.envelopes){
  if(!envelope||Object.keys(envelope).length!==2||!devices.has(envelope.deviceId)||recipients.has(envelope.deviceId)||!Buffer.isBuffer(envelope.ciphertext)||envelope.ciphertext.length<48)throw Error("INVALID_KEY_ENVELOPE");
  recipients.add(envelope.deviceId);
 }
 return {...state,devices,usedIds,usedSigningKeys,revision:b.revision,head:p.fingerprint(record),keyGeneration:b.keyGeneration,recoveryKey:b.recoveryKey};
}

return {verifyGenesis,applyMembership,applyRecovery,applyTransition,verifyMutation,validDevice};
}
module.exports={createMembership};
