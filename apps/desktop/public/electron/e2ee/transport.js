const p=require("./protocol");
function createTransport({endpoint,token,fetch:send=globalThis.fetch,timeout=15000}){
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
   const credentials=await token();
   if(typeof credentials!=="string"||!credentials)throw Error("AUTH_REQUIRED");
   const response=await send(new URL(path,base).href,{method:record?"POST":"GET",headers:{Authorization:"Bearer "+credentials,...(record?{"Content-Type":"application/cbor"}:{})},body:record?p.encode(record):undefined,signal:controller.signal,redirect:"error"});
   const reader=response.body?.getReader();if(!reader)throw Error("INVALID_SYNC_RESPONSE");
   const chunks=[];let length=0;
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxResponse){await reader.cancel();throw Error("SYNC_RESPONSE_TOO_LARGE");}chunks.push(Buffer.from(value));}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw Error("INVALID_SYNC_RESPONSE");}
   if(!response.ok){
    if(response.status===404&&body?.code==="VAULT_NOT_FOUND")throw Error("VAULT_NOT_FOUND");
    const allowed=new Set(["E2EE_NOT_ACTIVE","OBJECT_CONFLICT","SYNC_CHECKPOINT_CONFLICT","DEVICE_FORBIDDEN","NOT_FOUND","SNAPSHOT_LIMIT","UNAUTHORIZED","USER_REQUIRED","MIGRATION_CONFLICT","MIGRATION_NOT_FOUND","MIGRATION_SOURCE_LIMIT"]);
    throw Error(allowed.has(body?.code)?body.code:"SYNC_UNAVAILABLE");
   }
   return body;
  }catch(error){
   const allowed=new Set(["AUTH_REQUIRED","INVALID_SYNC_RESPONSE","SYNC_RESPONSE_TOO_LARGE","E2EE_NOT_ACTIVE","OBJECT_CONFLICT","SYNC_CHECKPOINT_CONFLICT","DEVICE_FORBIDDEN","NOT_FOUND","SNAPSHOT_LIMIT","UNAUTHORIZED","USER_REQUIRED","SYNC_UNAVAILABLE","MIGRATION_CONFLICT","MIGRATION_NOT_FOUND","MIGRATION_SOURCE_LIMIT"]);
   throw Error(controller.signal.aborted?"SYNC_CANCELLED":allowed.has(error.message)||error.message==="VAULT_NOT_FOUND"?error.message:"SYNC_UNAVAILABLE");
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
 }
 return {membership:(after=0,signal)=>request("/v3/vault?after="+encodeURIComponent(after),null,signal),
  accountStatus:signal=>request("/v3/vault/status",null,signal),
  migrationPrepare:(record,signal)=>request("/v3/migration/prepare",record,signal),
  migrationPush:(record,signal)=>request("/v3/migration/push",record,signal),
  migrationSnapshot:(record,signal)=>request("/v3/migration/snapshot",record,signal),
  migrationSnapshotPage:(record,signal)=>request("/v3/migration/snapshot/page",record,signal),
  migrationVerify:(record,signal)=>request("/v3/migration/verify",record,signal),
  migrationCommit:(record,signal)=>request("/v3/migration/commit",record,signal),
  migrationStatus:(record,signal)=>request("/v3/migration/status",record,signal),
  migrationSource:(record,signal)=>request("/v3/migration/source",record,signal,32*p.MAX_BYTES),
  migrationCancel:(record,signal)=>request("/v3/migration/cancel",record,signal),
  push:(record,signal)=>request("/v3/sync/push",record,signal),
  envelope:(record,signal)=>request("/v3/sync/envelope",record,signal),
  transition:(record,signal)=>request("/v3/vault/transition",record,signal),
  createVault:(record,signal)=>request("/v3/vault",record,signal),
  approve:(record,signal)=>request("/v3/vault/membership",record,signal),
  pull:(record,signal)=>request("/v3/sync/pull",record,signal),
  snapshot:(record,signal)=>request("/v3/sync/snapshot",record,signal),
  snapshotPage:(record,signal)=>request("/v3/sync/snapshot/page",record,signal)};
}
module.exports={createTransport};
