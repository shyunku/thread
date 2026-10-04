// Main-process only. Server-side login session actions; tokens never leave this module.
function sessionURL(endpoint,path){
 const base=new URL(endpoint);
 if(base.username||base.password||base.search||base.hash||
  (base.protocol!=="https:"&&!(base.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(base.hostname))))
  throw Error("INSECURE_SESSION_ENDPOINT");
 return new URL(path,base).href;
}
async function post({url,headers,body,send,signal,timeout}){
 const controller=new AbortController(),abort=()=>controller.abort();
 signal?.addEventListener("abort",abort,{once:true});
 const timer=setTimeout(abort,timeout);
 try{
  const response=await send(url,{method:"POST",headers:{...headers,...(body?{"Content-Type":"application/json"}:{})},
   body:body?JSON.stringify(body):undefined,signal:controller.signal,redirect:"error"});
  let code=null;
  if(!response.ok){
   const text=await response.text().catch(()=>"");
   if(text.length<=1024)try{code=JSON.parse(text)?.code??null;}catch{}
  }else await response.body?.cancel?.();
  return {status:response.status,code};
 }finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
// Ends this device's session on the server. Best effort: logging out locally must not depend on it.
async function logout({endpoint,refreshToken,fetch:send=globalThis.fetch,timeout=5000}){
 if(typeof refreshToken!=="string"||!refreshToken)return false;
 try{
  const {status}=await post({url:sessionURL(endpoint,"/v1/auth/logout"),headers:{"X-Refresh-Token":refreshToken},send,timeout});
  return status===204;
 }catch{return false;}
}
// Ends every other session of the account and keeps this one.
async function revokeOtherSessions({endpoint,tokens,fetch:send=globalThis.fetch,signal,timeout=15000}){
 const url=sessionURL(endpoint,"/v1/auth/sessions/revoke");
 let access=await tokens.current();
 if(typeof access!=="string"||!access)throw Error("AUTH_REQUIRED");
 for(let attempt=0;attempt<2;attempt++){
  const {status,code}=await post({url,headers:{Authorization:"Bearer "+access},body:{keep_current:true},send,signal,timeout});
  if(status===204)return true;
  // An expired token, or one issued before sessions existed, is renewed once.
  if(attempt||!(status===401||(status===409&&code==="SESSION_REFRESH_REQUIRED")))
   throw Error(status===401?"UNAUTHORIZED":"SESSION_UNAVAILABLE");
  access=await tokens.renew(access);
 }
}
module.exports={logout,revokeOtherSessions};
