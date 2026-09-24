const {randomBytes}=require("node:crypto");
const p=require("./protocol"),{historyFor}=require("./filePairing");
const {validateKeys}=require("./keyTransition");

async function activateEmpty({store,transport,signal}){
 const identity=store.get("recovery","$owner-identity");
 try{
 if(identity?.phase!=="RECOVERY_CONFIRMED"||
  store.get("recovery","$owner-registration")?.phase!=="REGISTERED")throw Error("RECOVERY_CONFIRMATION_REQUIRED");
 const ready=()=>{if(signal?.aborted)throw Error("SYNC_CANCELLED");store.scope();};
 ready();
 const remote=await transport.accountStatus(signal);ready();
 if(remote.vaultId!==store.scope().vaultId||
  !((remote.accountMode==="e2ee_pending"&&remote.vaultMode==="pending")||
    (remote.accountMode==="e2ee"&&remote.vaultMode==="active")))throw Error("ACCOUNT_STATE_CHANGED");
 const history=await historyFor(store,{membership:after=>transport.membership(after,signal)},identity.fingerprint);ready();
 const state=history.current,member=state.devices.get(identity.deviceId);
 if(!member||member.role!=="write"||!member.canAuthorizeDevices||
  !member.signingKey.equals(identity.device.signing.publicKey)||state.revision!==remote.revision||
  state.head!==remote.head||state.keyGeneration!==remote.keyGeneration)throw Error("DEVICE_FORBIDDEN");
 validateKeys(identity.keyring.keys,state.keyGeneration);
 if(remote.accountMode==="e2ee")return {phase:"ACTIVE"};
 const body={schema:1,vaultId:state.vaultId,deviceId:identity.deviceId,epoch:remote.epoch,
  membershipRevision:state.revision,keyGeneration:state.keyGeneration,operation:"activate-empty",
  parameters:{},requestId:randomBytes(16).toString("hex"),expiresAt:Date.now()+60000};
 const record={body,signature:await p.sign(identity.device.signing.privateKey,"migration",body)};
 ready();
 const result=await transport.activateEmpty(record,signal);ready();
 if(result.accountMode!=="e2ee"||result.vaultMode!=="active"||result.vaultId!==state.vaultId||
  result.epoch!==remote.epoch||result.head!==state.head)throw Error("ACCOUNT_STATE_CHANGED");
 return {phase:"ACTIVE"};
 }finally{
  identity?.device?.signing?.privateKey?.fill(0);
  identity?.device?.encryption?.privateKey?.fill(0);
  identity?.recoverySecret?.fill(0);
  for(const key of identity?.keyring?.keys||[])key.key?.fill(0);
 }
}
module.exports={activateEmpty};
