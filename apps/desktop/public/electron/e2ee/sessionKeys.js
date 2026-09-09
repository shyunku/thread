const p=require("./protocol"),{openTransition,validateKeys}=require("./keyTransition");
const same=(a,b)=>p.encode(a).equals(p.encode(b));
// Only signed transitions can replace a stored keyring. No server JSON key material.
async function refreshSessionKeys({store,identityKey,identity,history,epoch,ready}){
 ready();
 const state=history.current,member=state.devices.get(identity.deviceId),original=identity.keyring;
 if(!member||!member.signingKey.equals(identity.device.signing.publicKey)||!member.encryptionKey.equals(identity.device.encryption.publicKey))throw Error("DEVICE_FORBIDDEN");
 if(original.vaultId!==state.vaultId||original.genesisFingerprint!==history.pin||original.keyGeneration>state.keyGeneration)throw Error("INVALID_KEYRING");
 validateKeys(original.keys,original.keyGeneration);
 if(original.keyGeneration===state.keyGeneration)return;
 let ring=original;
 const temporary=[];
 try{
  for(const [revision,record] of history.records){
   if(!record.body.envelopes||record.body.keyGeneration<=ring.keyGeneration)continue;
   if(record.body.keyGeneration!==ring.keyGeneration+1)throw Error("KEY_HISTORY_MISSING");
   const opened=await openTransition({state:history.at(revision-1),record,epoch,deviceId:identity.deviceId,device:identity.device,knownKeys:ring.keys});
   temporary.push(opened.keyring);ready();ring=opened.keyring;
  }
  if(ring.keyGeneration!==state.keyGeneration)throw Error("KEY_REFRESH_REQUIRED");
  ready();
  store.transaction(db=>{
   const saved=db.get("recovery",identityKey);
   if(!same(saved,identity))throw Error("IDENTITY_CHANGED");
   db.put("recovery",identityKey,{...saved,keyring:ring});
  });
  identity.keyring=ring;
  for(const entry of original.keys)entry.key.fill(0);
 }finally{
  for(const candidate of temporary)if(candidate!==identity.keyring)for(const entry of candidate.keys)entry.key.fill(0);
 }
}
module.exports={refreshSessionKeys};
