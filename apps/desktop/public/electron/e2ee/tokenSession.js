// Main-process only. Never pass tokens through the legacy SQL/HTTP loggers.
function createTokenSession({database,uid,endpoint,send=globalThis.fetch,signal,active,notify}){
 let pending=null;
 const read=async()=>{
  active();
  const root=await database();
  const row=await new Promise((resolve,reject)=>root.db.get(
   "SELECT access_token, refresh_token FROM users WHERE uid = ?",[uid],
   (error,value)=>error?reject(error):resolve(value)));
  active();
  return {root,row};
 };
 const current=async()=>{const {row}=await read();return row?.access_token;};
 const renew=async stale=>{
  if(pending)return pending;
  const running=(async()=>{
   const {root,row}=await read();
   if(row?.access_token&&row.access_token!==stale)return row.access_token;
   if(!row?.refresh_token)throw Error("UNAUTHORIZED");
   const controller=new AbortController(),abort=()=>controller.abort();
   signal.addEventListener("abort",abort,{once:true});
   const timer=setTimeout(abort,15000);
   try{
    const response=await send(new URL("/v1/auth/refreshToken",endpoint).href,{
     method:"POST",headers:{Authorization:"Bearer "+stale,"X-Refresh-Token":row.refresh_token},
     signal:controller.signal,redirect:"error"
    });
    if(!response.ok)throw Error("UNAUTHORIZED");
    const reader=response.body?.getReader();
    if(!reader)throw Error("UNAUTHORIZED");
    const chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
     if(size>8192){await reader.cancel();throw Error("UNAUTHORIZED");}chunks.push(Buffer.from(value));
    }
    let result;try{result=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw Error("UNAUTHORIZED");}
    const access=result?.access_token?.token,refresh=result?.refresh_token?.token;
    if(typeof access!=="string"||!access||access.length>8192||
       typeof refresh!=="string"||!refresh||refresh.length>8192)throw Error("UNAUTHORIZED");
    active();
    const changes=await new Promise((resolve,reject)=>root.db.run(
     "UPDATE users SET access_token = ?, refresh_token = ? WHERE uid = ? AND access_token = ? AND refresh_token = ?",
     [access,refresh,uid,stale,row.refresh_token],function(error){error?reject(error):resolve(this.changes);}));
    if(changes!==1)throw Error("AUTH_REQUIRED");
    active();
    notify?.({accessToken:access,refreshToken:refresh});
    return access;
   }catch(error){
    throw Error(controller.signal.aborted?"SYNC_CANCELLED":error?.message==="AUTH_REQUIRED"?"AUTH_REQUIRED":"UNAUTHORIZED");
   }finally{clearTimeout(timer);signal.removeEventListener("abort",abort);}
  })();
  pending=running;
  try{return await running;}finally{if(pending===running)pending=null;}
 };
 return {current,renew};
}
module.exports={createTokenSession};
