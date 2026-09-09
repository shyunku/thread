const p=require("./protocol"),pair=require("./pairing"),{MembershipHistory}=require("./readProtocol"),{validateKeys}=require("./keyTransition");
const {PairingCoordinator}=require("./pairingCoordinator");
const same=(a,b)=>p.encode(a).equals(p.encode(b));
async function historyFor(store,transport,pin){
 let page=await transport.membership(0);store.scope();
 const genesis=p.decode(Buffer.from(page.genesis,"base64")),history=await new MembershipHistory(genesis,pin).initialize();
 if(history.current.vaultId!==store.scope().vaultId)throw Error("PAIRING_SCOPE_MISMATCH");
 for(let i=0;i<4096;i++){
  if(!same(p.decode(Buffer.from(page.genesis,"base64")),genesis)||page.more&&!page.records?.length)throw Error("INVALID_MEMBERSHIP_PAGE");
  await history.appendPage(page);store.scope();
  if(!page.more){
   store.transaction(db=>{
    const key="$pair-history-"+pin,previous=db.get("recovery",key);
    if(previous&&(previous.revision>history.current.revision||history.at(previous.revision).head!==previous.head))throw Error("MEMBERSHIP_ROLLBACK");
    db.put("recovery",key,{revision:history.current.revision,head:history.current.head});
   });
   return history;
  }
  page=await transport.membership(history.current.revision);store.scope();
 }
 throw Error("MEMBERSHIP_HISTORY_LIMIT");
}
async function createRecipientRequest({store,transport,fingerprint,now=Date.now()}){
 if(typeof fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(fingerprint))throw Error("GENESIS_PIN_REQUIRED");
 if(store.get("recovery","$paired-device"))throw Error("DEVICE_ALREADY_PAIRED");
 const history=await historyFor(store,transport,fingerprint),current=store.get("recovery","$pair-current");
 const old=current&&store.get("recovery","$pair-recipient-"+current);
 if(old&&old.request.body.expiresAt>now){
  if(old.fingerprint!==fingerprint)throw Error("PAIRING_REQUEST_CHANGED");
  return publicRequest(old.request);
 }
 const device=await p.createDevice();
 try{
  const request=await pair.createRequest({vaultId:store.scope().vaultId,genesisFingerprint:fingerprint,device,role:"write",canAuthorizeDevices:false,now});
  return store.transaction(db=>{
   if(db.get("recovery","$pair-current")!==current)throw Error("PAIRING_REQUEST_CHANGED");
   db.put("recovery","$pair-recipient-"+request.body.requestId,{device,request,fingerprint,genesis:history.genesis,phase:"WAITING"});
   db.put("recovery","$pair-current",request.body.requestId);return publicRequest(request);
  });
 }finally{device.signing.privateKey.fill(0);device.encryption.privateKey.fill(0);}
}
function publicRequest(request){return {requestId:request.body.requestId,fingerprint:pair.requestFingerprint(request),expiresAt:request.body.expiresAt,role:request.body.device.role};}
async function requestFile(store,now=Date.now()){
 const id=store.get("recovery","$pair-current"),saved=id&&store.get("recovery","$pair-recipient-"+id);
 if(!saved)throw Error("PAIRING_REQUEST_REQUIRED");await pair.verifyRequest(saved.request,now);store.scope();
 return pair.toRequestFile(saved.request);
}
async function previewRequest(store,bytes,now=Date.now()){
 const request=await pair.fromRequestFile(bytes,now);
 if(request.body.vaultId!==store.scope().vaultId)throw Error("PAIRING_SCOPE_MISMATCH");
 store.put("recovery","$pair-preview-"+request.body.requestId,request);return publicRequest(request);
}
async function approveRequest({store,transport,requestId,fingerprint,reauthenticate,now=()=>Date.now()}){
 if(typeof requestId!=="string"||!/^[a-f0-9]{32}$/.test(requestId))throw Error("INVALID_REQUEST_ID");
 const request=store.get("recovery","$pair-preview-"+requestId),owner=store.get("recovery","$owner-identity");
 if(!request||owner?.phase!=="RECOVERY_CONFIRMED")throw Error("PAIRING_AUTHORITY_REQUIRED");
 const history=await historyFor(store,transport,owner.fingerprint);
 validateKeys(owner.keyring.keys,history.current.keyGeneration);
 if(owner.keyring.keyGeneration!==history.current.keyGeneration)throw Error("KEY_REFRESH_REQUIRED");
 return new PairingCoordinator({store,history,transport,reauthenticate,now}).approve({
  request,authority:owner.device,authorityId:owner.deviceId,keyring:owner.keyring,confirmedFingerprint:fingerprint});
}
async function acceptFile({store,transport,bytes,now=Date.now()}){
 if(!Buffer.isBuffer(bytes)||bytes.length>512*1024)throw Error("INVALID_TRANSFER");
 const id=store.get("recovery","$pair-current"),saved=id&&store.get("recovery","$pair-recipient-"+id);
 if(!saved)throw Error("PAIRING_REQUEST_REQUIRED");
 const transfer=p.decode(bytes),revision=transfer.event?.body?.revision;
 if(!Number.isSafeInteger(revision)||revision<1)throw Error("INVALID_TRANSFER");
 const history=await historyFor(store,transport,saved.fingerprint);
 if(history.current.revision<revision)throw Error("APPROVAL_NOT_COMMITTED");
 const accepted=await pair.acceptTransfer({bytes,request:saved.request,device:saved.device,state:history.at(revision-1),genesisFingerprint:saved.fingerprint,now});
 if(history.at(revision).head!==accepted.state.head||
  !same(history.current.devices.get(saved.request.body.device.id)||null,saved.request.body.device)||
  history.current.keyGeneration!==accepted.state.keyGeneration)throw Error("APPROVAL_NOT_CURRENT");
 const ring=accepted.keyring;
 if(ring?.schema!==1||ring.vaultId!==store.scope().vaultId||ring.genesisFingerprint!==saved.fingerprint||
  ring.keyGeneration!==history.current.keyGeneration)throw Error("INVALID_KEYRING");
 validateKeys(ring.keys,ring.keyGeneration);
 return store.transaction(db=>{
  if(db.get("recovery","$pair-current")!==id)throw Error("PAIRING_REQUEST_CHANGED");
  const existing=db.get("recovery","$paired-device");
  if(existing){
   if(existing.requestId!==id||!same(existing.keyring,ring))throw Error("PAIRED_DEVICE_EXISTS");
   return {phase:"PAIRED",deviceId:existing.deviceId};
  }
  db.put("recovery","$paired-device",{requestId:id,device:saved.device,deviceId:saved.request.body.device.id,genesis:saved.genesis,fingerprint:saved.fingerprint,keyring:ring,head:history.current.head,revision:history.current.revision});
  db.put("recovery","$pair-recipient-"+id,{...saved,phase:"PAIRED"});
  return {phase:"PAIRED",deviceId:saved.request.body.device.id};
 });
}
module.exports={createRecipientRequest,requestFile,previewRequest,approveRequest,acceptFile};
