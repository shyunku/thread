// Never forward exception text, URLs, SQL or account data to the renderer.
const codes=new Set(["AUTH_REQUIRED","ACCOUNT_MISMATCH","VAULT_SESSION_CHANGED","VAULT_BUSY","APPLICATION_MODE_CHANGED","APPLICATION_MODE_UNAVAILABLE","INSECURE_SYNC_ENDPOINT","SYNC_UNAVAILABLE","SYNC_CANCELLED","UNAUTHORIZED","USER_REQUIRED"]);
async function vaultIpcReply(service,topic,action,args){
 try{
  // Bootstrap deliberately establishes the requested account before probing it.
  // Comparing to the previous (often null) account rejects a successful first launch.
  const uid=topic==="vault/bootstrap"?args[0]:service.userService.getCurrent();
  const data=await action(...args);
  if(uid!==service.userService.getCurrent())throw Error("VAULT_SESSION_CHANGED");
  return {success:true,data};
 }catch(error){
  return {success:false,data:{code:topic==="vault/bootstrap"&&codes.has(error?.message)?error.message:"VAULT_ACTION_FAILED"}};
 }
}
module.exports={vaultIpcReply};
