const sodium=require("libsodium-wrappers"),p=require("./protocol"),m=require("./membership"),recovery=require("./recovery");
function check(value,code="INVALID_KEYRING"){if(!value)throw Error(code);}
function validateKeys(keys,generation){
 check(Array.isArray(keys)&&keys.length>=1&&keys.length<=256);
 const seen=new Set();
 for(const entry of keys){check(entry&&Object.keys(entry).length===2&&Number.isSafeInteger(entry.generation)&&entry.generation>0&&entry.generation<=generation&&!seen.has(entry.generation)&&Buffer.isBuffer(entry.key)&&entry.key.length===32);seen.add(entry.generation);}
 check(seen.has(generation));return keys;
}
async function proposeTransition({state,epoch,deviceId,device,recipients,keys,operation="rotate",recoveryAuthoritySecret}){
 await sodium.ready;validateKeys(keys,state.keyGeneration);
 check(["rotate","recover"].includes(operation)&&typeof epoch==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(epoch));
 const signer=operation==="rotate"?device?.signing.privateKey:recoveryAuthoritySecret;
 check(Buffer.isBuffer(signer)&&signer.length===64,"TRANSITION_AUTH_REQUIRED");
 const generation=state.keyGeneration+1,key=Buffer.from(sodium.randombytes_buf(32)),authority=sodium.crypto_sign_keypair();
 const nextKeys=[...keys.map(e=>({generation:e.generation,key:Buffer.from(e.key)})),{generation,key}];
 const ring={schema:1,vaultId:state.vaultId,genesisFingerprint:state.genesisFingerprint,epoch,keyGeneration:generation,revision:state.revision+1,previous:state.head,keys:nextKeys};
 let recoveryKit,success=false;
 try{
  check(Array.isArray(recipients)&&recipients.length>=1&&recipients.length<=32);
  const envelopes=[];
  for(const recipient of recipients){
   m.validDevice(recipient);const plain=p.encode({...ring,recipient:recipient.id});
   try{envelopes.push({deviceId:recipient.id,ciphertext:Buffer.from(sodium.crypto_box_seal(plain,recipient.encryptionKey))});}finally{plain.fill(0);}
  }
  recoveryKit=await recovery.createRecovery(state.vaultId,state.genesisFingerprint,ring,Buffer.from(authority.privateKey));
  const body={schema:1,vaultId:state.vaultId,revision:state.revision+1,previous:state.head,operation,signer:operation==="rotate"?deviceId:null,keyGeneration:generation,recoveryKey:Buffer.from(authority.publicKey),devices:recipients,envelopes,recoveryEnvelope:p.encode(recoveryKit.bundle)};
  const record={body,signature:await p.sign(signer,operation==="rotate"?"membership-transition":"recovery-transition",body)};
  const next=await m.applyTransition(state,record);
  success=true;return {record,state:next,keyring:ring,recovery:recoveryKit};
 }finally{
  authority.privateKey.fill(0);
  if(!success){nextKeys.forEach(e=>e.key.fill(0));recoveryKit?.secret.fill(0);}
 }
}
async function openTransition({state,record,epoch,deviceId,device,knownKeys=[]}){
 await sodium.ready;const next=await m.applyTransition(state,record),recipient=next.devices.get(deviceId);
 check(recipient&&recipient.signingKey.equals(device.signing.publicKey)&&recipient.encryptionKey.equals(device.encryption.publicKey),"DEVICE_REVOKED");
 const envelope=record.body.envelopes.find(e=>e.deviceId===deviceId);
 const plain=Buffer.from(sodium.crypto_box_seal_open(envelope.ciphertext,device.encryption.publicKey,device.encryption.privateKey));
 try{
  const ring=p.decode(plain);
  check(ring.schema===1&&ring.vaultId===next.vaultId&&ring.genesisFingerprint===next.genesisFingerprint&&ring.epoch===epoch&&ring.revision===next.revision&&ring.previous===state.head&&ring.recipient===deviceId&&ring.keyGeneration===next.keyGeneration);
  validateKeys(ring.keys,next.keyGeneration);
  for(const known of knownKeys){const delivered=ring.keys.find(e=>e.generation===known.generation);check(delivered&&delivered.key.equals(known.key),"HISTORICAL_KEY_CHANGED");}
  return {state:next,keyring:ring};
 }finally{plain.fill(0);}
}
module.exports={proposeTransition,openTransition,validateKeys};
