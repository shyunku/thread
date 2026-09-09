const p=require("./protocol"),pair=require("./pairing");
const {MembershipHistory}=require("./readProtocol");
const same=(a,b)=>p.encode(a).equals(p.encode(b));
// Main-process coordinator; only encrypted transfer bytes leave this module.
// Durable proposals are not approval receipts and must never be exported early.
class PairingCoordinator{
 constructor({store,history,transport,reauthenticate,now=()=>Date.now()}){
  Object.assign(this,{store,history,transport,reauthenticate,now});this.running=false;
 }
 async approve({request,authority,authorityId,keyring,confirmedFingerprint}){
  if(this.running)throw Error("PAIRING_BUSY");this.running=true;
  try{
   const {store,history,transport}=this;
   await pair.verifyRequest(request,this.now());
   if(store.scope().vaultId!==history.current.vaultId||request.body.vaultId!==history.current.vaultId||
    confirmedFingerprint!==pair.requestFingerprint(request))throw Error("PAIRING_SCOPE_MISMATCH");
   const key="$pair-approval-"+request.body.requestId;
   let saved=store.get("recovery",key);
   if(saved){
    if(!same(saved.request,request)||saved.authorityId!==authorityId)throw Error("PAIRING_REQUEST_CHANGED");
    if(await this.reauthenticate()!==true)throw Error("REAUTH_REQUIRED");
   }else{
    const proposal=await pair.proposeApproval({request,state:history.current,authority,authorityId,keyring,confirmedFingerprint,reauthenticate:this.reauthenticate,now:this.now});
    saved={request,authorityId,event:proposal.event,transfer:pair.toTransferFile(proposal.transfer),generation:proposal.next.keyGeneration,phase:"PREPARED"};
    store.transaction(db=>{if(db.get("recovery",key))throw Error("PAIRING_BUSY");db.put("recovery",key,saved);});
   }
   await pair.verifyRequest(request,this.now());
   // Exact original event, including nonce-independent signature and expiry.
   // Unknown ACK is retried without generating a second device or event.
   store.get("recovery",key);
   await transport.approve(saved.event);
   store.get("recovery",key);
   const remote=await new MembershipHistory(history.genesis,history.pin).initialize();
   let found=false,complete=false;
   for(let pages=0;pages<4096;pages++){
    const page=await transport.membership(remote.current.revision);
    store.get("recovery",key);
    if(!Array.isArray(page.records)||page.more&&page.records.length===0)throw Error("PAIRING_CONFIRMATION_FAILED");
    for(const raw of page.records){
     const record=p.decode(Buffer.from(raw,"base64"));
     if(record.body.revision===saved.event.body.revision){if(!same(record,saved.event))throw Error("PAIRING_EVENT_CONFLICT");found=true;}
    }
    await remote.appendPage(page);
    if(!page.more){complete=true;break;}
   }
   const recipient=remote.current.devices.get(request.body.device.id),signer=remote.current.devices.get(authorityId);
   if(!complete||!found||!recipient||!same(recipient,request.body.device)||!signer?.canAuthorizeDevices||
    remote.current.keyGeneration!==saved.generation)throw Error("PAIRING_CONFIRMATION_FAILED");
   await pair.verifyRequest(request,this.now());
   return store.transaction(db=>{
    const current=db.get("recovery",key);
    if(!current||!same(current.event,saved.event)||!same(current.request,request))throw Error("PAIRING_REQUEST_CHANGED");
    db.put("recovery",key,{...saved,phase:"CONFIRMED",confirmedHead:remote.current.head});
    return Buffer.from(saved.transfer);
   });
  }finally{this.running=false;}
 }
}
module.exports={PairingCoordinator};
