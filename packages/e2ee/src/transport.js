const p=require("./protocol");
function createTransport({endpoint,token,renewToken,fetch:send=globalThis.fetch,timeout=15000}){
 const base=new URL(endpoint);
 if(base.username||base.password||base.search||base.hash||
  (base.protocol!=="https:"&&!(base.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(base.hostname))))
  throw Error("INSECURE_SYNC_ENDPOINT");
 async function request(path,record,signal,maxResponse=8*p.MAX_BYTES){
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)throw Error("SYNC_CANCELLED");
  signal?.addEventListener("abort",abort,{once:true});
  const timer=setTimeout(abort,timeout);
  try{
   let credentials=await token();
   if(typeof credentials!=="string"||!credentials)throw Error("AUTH_REQUIRED");
   let response;
   for(let attempt=0;attempt<2;attempt++){
    response=await send(new URL(path,base).href,{method:record?"POST":"GET",headers:{Authorization:"Bearer "+credentials,...(record?{"Content-Type":"application/cbor"}:{})},body:record?p.encode(record):undefined,signal:controller.signal,redirect:"error"});
    if(response.status!==401)break;
    await response.body?.cancel?.();
    if(attempt||typeof renewToken!=="function")throw Error("UNAUTHORIZED");
    credentials=await renewToken(credentials);
    if(typeof credentials!=="string"||!credentials)throw Error("UNAUTHORIZED");
   }
   if(response.status===204){await response.body?.cancel?.();return null;}
   const reader=response.body?.getReader();if(!reader)throw Error("INVALID_SYNC_RESPONSE");
   const chunks=[];let length=0;
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxResponse){await reader.cancel();throw Error("SYNC_RESPONSE_TOO_LARGE");}chunks.push(Buffer.from(value));}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw Error("INVALID_SYNC_RESPONSE");}
   if(!response.ok){
    if(response.status===426&&body?.code==="UPDATE_REQUIRED")throw Error("UPDATE_REQUIRED");
    if(response.status===404&&body?.code==="VAULT_NOT_FOUND")throw Error("VAULT_NOT_FOUND");
    const allowed=new Set(["E2EE_NOT_ACTIVE","OBJECT_CONFLICT","SYNC_CHECKPOINT_CONFLICT","DEVICE_FORBIDDEN","NOT_FOUND","SNAPSHOT_LIMIT","UNAUTHORIZED","USER_REQUIRED","MIGRATION_CONFLICT","MIGRATION_NOT_FOUND","MIGRATION_SOURCE_LIMIT","PAIRING_NOT_FOUND","PAIRING_CONFLICT","INVALID_PAIRING","PAIRING_UNAVAILABLE"]);
    throw Error(allowed.has(body?.code)?body.code:"SYNC_UNAVAILABLE");
   }
   return body;
  }catch(error){
   const allowed=new Set(["AUTH_REQUIRED","INVALID_SYNC_RESPONSE","SYNC_RESPONSE_TOO_LARGE","E2EE_NOT_ACTIVE","OBJECT_CONFLICT","SYNC_CHECKPOINT_CONFLICT","DEVICE_FORBIDDEN","NOT_FOUND","SNAPSHOT_LIMIT","UNAUTHORIZED","USER_REQUIRED","SYNC_UNAVAILABLE","MIGRATION_CONFLICT","MIGRATION_NOT_FOUND","MIGRATION_SOURCE_LIMIT","PAIRING_NOT_FOUND","PAIRING_CONFLICT","INVALID_PAIRING","PAIRING_UNAVAILABLE"]);
   throw Error(controller.signal.aborted?"SYNC_CANCELLED":allowed.has(error.message)||["VAULT_NOT_FOUND","UPDATE_REQUIRED"].includes(error.message)?error.message:"SYNC_UNAVAILABLE");
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
 }
 return {membership:(after=0,signal)=>request("/v3/vault?after="+encodeURIComponent(after),null,signal),
  accountStatus:signal=>request("/v3/vault/status",null,signal),
  legacyCapabilities:signal=>request("/v2/sync/capabilities",null,signal),
  migrationSourceSnapshot:(record,signal)=>request("/v3/migration/source/snapshot",record,signal),
  migrationPrepare:(record,signal)=>request("/v3/migration/prepare",record,signal),
  migrationPush:(record,signal)=>request("/v3/migration/push",record,signal),
  migrationSnapshot:(record,signal)=>request("/v3/migration/snapshot",record,signal),
  migrationSnapshotPage:(record,signal)=>request("/v3/migration/snapshot/page",record,signal),
  migrationVerify:(record,signal)=>request("/v3/migration/verify",record,signal),
  migrationCommit:(record,signal)=>request("/v3/migration/commit",record,signal),
  migrationStatus:(record,signal)=>request("/v3/migration/status",record,signal),
  migrationSource:(record,signal)=>request("/v3/migration/source",record,signal,32*p.MAX_BYTES),
  migrationCancel:(record,signal)=>request("/v3/migration/cancel",record,signal),
  // Device-connection relay (v3-relay-pairing.md). Values are verified by the devices.
  pairingSession:signal=>request("/v3/pairing/session",null,signal),
  pairingCreate:(record,signal)=>request("/v3/pairing/session",record,signal),
  pairingRequest:(record,signal)=>request("/v3/pairing/session/request",record,signal),
  pairingReveal:(record,signal)=>request("/v3/pairing/session/reveal",record,signal),
  pairingTransfer:(record,signal)=>request("/v3/pairing/session/transfer",record,signal),
  pairingCancel:(record,signal)=>request("/v3/pairing/session/cancel",record,signal),
  push:(record,signal)=>request("/v3/sync/push",record,signal),
  envelope:(record,signal)=>request("/v3/sync/envelope",record,signal),
  transition:(record,signal)=>request("/v3/vault/transition",record,signal),
  recoverPending:(record,signal)=>request("/v3/vault/recovery",record,signal),
  createVault:(record,signal)=>request("/v3/vault",record,signal),
  activateEmpty:(record,signal)=>request("/v3/vault/activate-empty",record,signal),
  approve:(record,signal)=>request("/v3/vault/membership",record,signal),
  pull:(record,signal)=>request("/v3/sync/pull",record,signal),
  snapshot:(record,signal)=>request("/v3/sync/snapshot",record,signal),
  snapshotPage:(record,signal)=>request("/v3/sync/snapshot/page",record,signal),
  digest:(record,signal)=>request("/v3/sync/digest",record,signal)};
}
module.exports={createTransport};
