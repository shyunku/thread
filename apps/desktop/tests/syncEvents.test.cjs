const {test}=require("node:test"),assert=require("node:assert/strict");
const {startSyncEvents,syncScheduler}=require("../public/electron/e2ee/syncEvents");
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function stream(chunks){
 return new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close();}});
}

test("each changed event triggers a pull; heartbeats and split chunks are handled",async()=>{
 const abort=new AbortController(),calls=[];let changes=0;
 const send=async(url,init)=>{
  calls.push(init.headers.Authorization);
  if(calls.length===1)return new Response(stream(["event: changed\ndata: {}\n\n",": ping\n\n","event: chan","ged\ndata: {}\n\n"]),{status:200});
  abort.abort();return new Response(null,{status:503});
 };
 const events=startSyncEvents({endpoint:"https://api.fixture.invalid/",tokens:{current:async()=>"access-1",renew:async()=>"access-2"},
  onChange:()=>changes++,signal:abort.signal,fetch:send,minDelay:5});
 await events.done;
 assert.equal(changes,2);
 assert.equal(calls[0],"Bearer access-1");
});

test("an expired token is renewed once and the stream reconnects after it ends",async()=>{
 const abort=new AbortController(),seen=[];let changes=0;
 const send=async(url,init)=>{
  seen.push(init.headers.Authorization);
  if(seen.length===1)return new Response(null,{status:401});
  if(seen.length<=3)return new Response(stream(["event: changed\n\n"]),{status:200});
  abort.abort();return new Response(null,{status:503});
 };
 await startSyncEvents({endpoint:"https://api.fixture.invalid/",tokens:{current:async()=>"old",renew:async()=>"new"},
  onChange:()=>changes++,signal:abort.signal,fetch:send,minDelay:5}).done;
 assert.deepEqual(seen.slice(0,2),["Bearer old","Bearer new"]);
 assert.equal(changes,2);
});

test("insecure endpoints are refused",()=>{
 assert.throws(()=>startSyncEvents({endpoint:"http://api.fixture.invalid/",tokens:{},onChange(){},signal:new AbortController().signal}),/INSECURE/);
});

test("the scheduler coalesces signals and retries while the vault is busy",async()=>{
 let runs=0,busy=2;
 const schedule=syncScheduler(async()=>{runs++;if(busy-->0)throw Error("VAULT_BUSY");},{delay:5,retry:5});
 schedule();schedule();schedule();
 await wait(60);
 assert.equal(runs,3); // one coalesced run + two busy retries
});
