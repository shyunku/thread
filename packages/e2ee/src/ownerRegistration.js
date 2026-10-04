const p=require("./protocol"),{MembershipHistory}=require("./readProtocol");
const same=(a,b)=>p.encode(a).equals(p.encode(b));
function decodeGenesis(value){
 if(typeof value!=="string"||value.length>2*p.MAX_BYTES)throw Error("INVALID_GENESIS");
 const raw=Buffer.from(value,"base64");if(raw.toString("base64")!==value)throw Error("INVALID_GENESIS");return p.decode(raw);
}
async function registerOwner({store,transport,signal}){
 const identity=store.get("recovery","$owner-identity");
 if(!identity||identity.phase!=="RECOVERY_CONFIRMED")throw Error("RECOVERY_CONFIRMATION_REQUIRED");
 const genesis=identity.genesis,pin=identity.fingerprint,deviceId=identity.deviceId;
 const ready=()=>{
  if(signal?.aborted)throw Error("SYNC_CANCELLED");
  const current=store.get("recovery","$owner-identity");
  if(!current||current.phase!=="RECOVERY_CONFIRMED"||!same(current.genesis,genesis))throw Error("IDENTITY_CHANGED");
 };
 let page;ready();
 try{page=await transport.membership(0,signal);}
 catch(error){
  if(error.message!=="VAULT_NOT_FOUND")throw error;
  ready();
  // A previously confirmed registration cannot silently recreate a lost server vault.
  if(store.get("recovery","$owner-registration")?.phase==="REGISTERED")throw Error("SERVER_VAULT_MISSING");
  store.put("recovery","$owner-registration",{phase:"REGISTERING",fingerprint:pin});
  await transport.createVault(genesis,signal);
  ready();page=await transport.membership(0,signal);
 }
 ready();
 if(!same(decodeGenesis(page.genesis),genesis))return {phase:"PAIRING_REQUIRED"};
 const history=await new MembershipHistory(genesis,pin).initialize();
 for(let pages=0;pages<4096;pages++){
  ready();
  if(!same(decodeGenesis(page.genesis),genesis))throw Error("GENESIS_CHANGED");
  if(page.more&&(!Array.isArray(page.records)||!page.records.length))throw Error("MEMBERSHIP_PAGE_STALLED");
  await history.appendPage(page);ready();
  if(!page.more){
   const device=history.current.devices.get(deviceId);
   if(!device||!same(device,genesis.body.owner))return {phase:"PAIRING_REQUIRED"};
   return store.transaction(db=>{
    ready();const previous=db.get("recovery","$owner-registration");
    if(previous?.phase==="REGISTERED"&&(previous.revision>history.current.revision||
     history.at(previous.revision).head!==previous.head))throw Error("MEMBERSHIP_ROLLBACK");
    const result={phase:"REGISTERED",fingerprint:pin,revision:history.current.revision,head:history.current.head};
    db.put("recovery","$owner-registration",result);return result;
   });
  }
  page=await transport.membership(history.current.revision,signal);
 }
 throw Error("MEMBERSHIP_HISTORY_LIMIT");
}
module.exports={registerOwner};
