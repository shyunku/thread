// Device connection through the server relay (docs/initiatives/v3-encryption/protocol/v3-relay-pairing.md).
// The server only forwards values. The existing device commits to its nonce before it
// sees the new device's request, the new device sends its nonce before the reveal, and
// both show a 6-digit code derived from all of them. A relay that substitutes the vault
// or the request makes the codes differ.
const {randomBytes,createHash}=require("node:crypto");
const pair=require("./filePairing");
const COMMIT="thread-pair-commit-v1",SAS="thread-pair-sas-v1";
const commitment=nonce=>createHash("sha256").update(COMMIT).update(nonce).digest();
function sasCode({fingerprint,requestFingerprint,nonceE,nonceN}){
 const digest=createHash("sha256").update(SAS).update(Buffer.from(fingerprint,"hex")).update(Buffer.from(requestFingerprint,"hex"))
  .update(nonceE).update(nonceN).digest();
 return String(digest.readBigUInt64BE(0)%1000000n).padStart(6,"0");
}
const bytes=value=>typeof value==="string"?Buffer.from(value,"base64"):null;
function parse(session){
 if(!session||typeof session.sessionId!=="string"||!/^[a-f0-9]{32}$/.test(session.sessionId)||
  typeof session.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(session.fingerprint))throw Error("INVALID_PAIRING");
 return {sessionId:session.sessionId,vaultId:session.vaultId,fingerprint:session.fingerprint,expiresAt:session.expiresAt,
  commitment:bytes(session.commitment),request:bytes(session.request),nonceN:bytes(session.nonceN),
  nonceE:bytes(session.nonceE),transfer:bytes(session.transfer)};
}
async function current(transport){
 try{return parse(await transport.pairingSession());}
 catch(error){if(error.message==="PAIRING_NOT_FOUND")return null;throw error;}
}

// Existing device: opens a session, reveals its nonce once a request arrives, approves.
class OwnerRelay{
 constructor({store,transport,now=()=>Date.now()}){this.store=store;this.transport=transport;this.now=now;this.phase="IDLE";}
 async start(){
  const owner=this.store.get("recovery","$owner-identity");
  if(owner?.phase!=="RECOVERY_CONFIRMED")throw Error("PAIRING_AUTHORITY_REQUIRED");
  this.nonce=randomBytes(32);this.fingerprint=owner.fingerprint;this.request=null;this.code=null;
  const created=await this.transport.pairingCreate({vaultId:this.store.scope().vaultId,fingerprint:owner.fingerprint,commitment:commitment(this.nonce)});
  if(typeof created?.sessionId!=="string")throw Error("INVALID_PAIRING");
  this.sessionId=created.sessionId;this.expiresAt=created.expiresAt;this.phase="WAITING";
  return this.status();
 }
 status(){return {phase:this.phase,code:this.code,expiresAt:this.request?.expiresAt??this.expiresAt,role:this.request?.role??null};}
 async poll(){
  if(!["WAITING","COMPARE"].includes(this.phase))return this.status();
  const session=await current(this.transport);
  if(!session||session.sessionId!==this.sessionId){this.phase="EXPIRED";return this.status();}
  if(!session.request)return this.status();
  if(!this.request){
   if(session.nonceN?.length!==32)throw Error("INVALID_PAIRING");
   const record=await require("./pairing").fromRequestFile(session.request,this.now());
   if(record.body.genesisFingerprint!==this.fingerprint)throw Error("PAIRING_SCOPE_MISMATCH");
   const preview=await pair.previewRequest(this.store,session.request,this.now());
   this.requestBytes=session.request;this.nonceN=session.nonceN;this.request=preview;
   if(!session.nonceE)await this.transport.pairingReveal({sessionId:this.sessionId,nonce:this.nonce});
   this.code=sasCode({fingerprint:this.fingerprint,requestFingerprint:preview.fingerprint,nonceE:this.nonce,nonceN:this.nonceN});
   this.phase="COMPARE";
  }else if(!session.request.equals(this.requestBytes)||!session.nonceN?.equals(this.nonceN))throw Error("PAIRING_MISMATCH");
  return this.status();
 }
 async approve(reauthenticate){
  if(this.phase!=="COMPARE")throw Error("PAIRING_NOT_READY");
  const transfer=await pair.approveRequest({store:this.store,transport:this.transport,requestId:this.request.requestId,
   fingerprint:this.request.fingerprint,reauthenticate,now:this.now});
  await this.transport.pairingTransfer({sessionId:this.sessionId,transfer});
  this.phase="DONE";return this.status();
 }
 async cancel(){
  const id=this.sessionId;this.phase="CANCELLED";
  if(id)await this.transport.pairingCancel({sessionId:id}).catch(()=>{});
  return this.status();
 }
}

// New device: joins the account's session, sends its request, shows the code and
// accepts the transfer only after the user confirmed the codes match.
class RecipientRelay{
 constructor({store,transport,now=()=>Date.now()}){this.store=store;this.transport=transport;this.now=now;this.phase="WAITING";this.confirmed=false;}
 status(){return {phase:this.phase,code:this.code||null,expiresAt:this.expiresAt??null};}
 async poll(){
  if(["PAIRED","MISMATCH","CANCELLED"].includes(this.phase))return this.status();
  const session=await current(this.transport);
  if(!this.sessionId){
   // Wait for a fresh session from the existing device; one already in use is not ours.
   if(!session||session.request||session.expiresAt<=this.now())return this.status();
   if(session.vaultId!==this.store.scope().vaultId)throw Error("PAIRING_SCOPE_MISMATCH");
   if(session.commitment?.length!==32)throw Error("INVALID_PAIRING");
   const request=await pair.createRecipientRequest({store:this.store,transport:this.transport,fingerprint:session.fingerprint,now:this.now()});
   const requestBytes=await pair.requestFile(this.store,this.now()),nonce=randomBytes(32);
   await this.transport.pairingRequest({sessionId:session.sessionId,request:requestBytes,nonce});
   Object.assign(this,{sessionId:session.sessionId,fingerprint:session.fingerprint,commitment:session.commitment,
    requestBytes,requestFingerprint:request.fingerprint,nonce,expiresAt:request.expiresAt,phase:"CONNECTING"});
   return this.status();
  }
  if(!session||session.sessionId!==this.sessionId){this.phase="EXPIRED";return this.status();}
  if(!session.request?.equals(this.requestBytes)||!session.nonceN?.equals(this.nonce))throw Error("PAIRING_MISMATCH");
  if(!session.nonceE)return this.status();
  if(!this.code){
   if(session.nonceE.length!==32||!commitment(session.nonceE).equals(this.commitment)){this.phase="MISMATCH";await this.cancel();this.phase="MISMATCH";return this.status();}
   this.nonceE=session.nonceE;
   this.code=sasCode({fingerprint:this.fingerprint,requestFingerprint:this.requestFingerprint,nonceE:this.nonceE,nonceN:this.nonce});
   this.phase="COMPARE";
  }else if(!session.nonceE.equals(this.nonceE))throw Error("PAIRING_MISMATCH");
  if(!this.confirmed||!session.transfer)return this.status();
  const accepted=await pair.acceptFile({store:this.store,transport:this.transport,bytes:session.transfer,now:this.now()});
  if(accepted?.phase!=="PAIRED")throw Error("PAIRING_CONFIRMATION_FAILED");
  this.phase="PAIRED";
  await this.transport.pairingCancel({sessionId:this.sessionId}).catch(()=>{});
  return this.status();
 }
 confirm(){
  if(this.phase!=="COMPARE")throw Error("PAIRING_NOT_READY");
  this.confirmed=true;this.phase="APPROVAL";return this.status();
 }
 reject(){this.phase="MISMATCH";return this.cancel().then(()=>{this.phase="MISMATCH";return this.status();});}
 async cancel(){
  const id=this.sessionId;this.phase="CANCELLED";
  if(id)await this.transport.pairingCancel({sessionId:id}).catch(()=>{});
  return this.status();
 }
}
module.exports={OwnerRelay,RecipientRelay,sasCode,commitment};
