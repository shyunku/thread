// Main-process only. Listens to the server's "changed" signals (/v3/sync/events, SSE)
// so other devices' edits arrive within a second instead of at the next poll.
// The stream carries no data; onChange just triggers the normal signed pull.
const sleep=(ms,signal)=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);signal?.addEventListener("abort",()=>{clearTimeout(timer);resolve();},{once:true});});
function eventsURL(endpoint){
 const base=new URL(endpoint);
 if(base.username||base.password||base.search||base.hash||
  (base.protocol!=="https:"&&!(base.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(base.hostname))))
  throw Error("INSECURE_SYNC_ENDPOINT");
 return new URL("/v3/sync/events",base).href;
}
function startSyncEvents({endpoint,tokens,onChange,signal,fetch:send=globalThis.fetch,minDelay=1000,maxDelay=30000}){
 const url=eventsURL(endpoint);
 let delay=minDelay;
 const open=async token=>send(url,{headers:{Authorization:"Bearer "+token,Accept:"text/event-stream"},signal,redirect:"error"});
 const loop=async()=>{
  while(!signal.aborted){
   try{
    let token=await tokens.current();
    if(typeof token!=="string"||!token)throw Error("AUTH_REQUIRED");
    let response=await open(token);
    if(response.status===401){await response.body?.cancel?.();response=await open(await tokens.renew(token));}
    if(!response.ok||!response.body)throw Error("SYNC_EVENTS_UNAVAILABLE");
    delay=minDelay;
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
    for(;;){
     const {done,value}=await reader.read();if(done)break;
     buffer+=decoder.decode(value,{stream:true});
     let end;
     while((end=buffer.indexOf("\n\n"))>=0){
      const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
      if(/^event: changed$/m.test(block))onChange();
     }
     if(buffer.length>64*1024)buffer="";
    }
   }catch{/* reconnect below */}
   if(signal.aborted)return;
   await sleep(delay,signal);delay=Math.min(maxDelay,delay*2);
  }
 };
 const done=loop();
 return {done};
}
// Coalesces signals into one sync; retries while another vault action runs.
function syncScheduler(run,{delay=300,retry=1000,attempts=10}={}){
 let timer=null,tries=0;
 const fire=async()=>{
  timer=null;
  try{await run();tries=0;}
  catch(error){if(error?.message==="VAULT_BUSY"&&++tries<attempts)timer=setTimeout(fire,retry);else tries=0;}
 };
 return ()=>{if(!timer)timer=setTimeout(fire,delay);};
}
module.exports={startSyncEvents,syncScheduler};
