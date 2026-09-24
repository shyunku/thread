const {test}=require("node:test"),assert=require("node:assert/strict");
const {createTokenSession}=require("../public/electron/e2ee/tokenSession");
const {createTransport}=require("../public/electron/e2ee/transport");

function fixture(send){
 const row={access_token:"expired-access",refresh_token:"valid-refresh"},notifications=[];
 let writes=0,active=true;
 const database=async()=>({db:{
  get:(_sql,_args,callback)=>callback(null,{...row}),
  run:(_sql,args,callback)=>{writes++;assert.deepEqual(args.slice(2),["fixture","expired-access","valid-refresh"]);
   row.access_token=args[0];row.refresh_token=args[1];callback.call({changes:1},null);}
 }});
 const session=createTokenSession({database,uid:"fixture",endpoint:"http://127.0.0.1:4033",
  send,signal:new AbortController().signal,active:()=>{if(!active)throw Error("AUTH_REQUIRED");},
  notify:value=>notifications.push(value)});
 return {session,row,notifications,get writes(){return writes;},setActive:value=>{active=value;}};
}

test("v3 retries once after 401 using a rotated token without logging or losing the local account",async()=>{
 const calls=[];
 const send=async(url,options)=>{calls.push({path:new URL(url).pathname,authorization:options.headers.Authorization});
  if(new URL(url).pathname==="/v1/auth/refreshToken"){
   assert.equal(options.headers["X-Refresh-Token"],"valid-refresh");
   return new Response(JSON.stringify({access_token:{token:"new-access"},refresh_token:{token:"new-refresh"}}),{status:200});
  }
  return new Response(JSON.stringify(options.headers.Authorization==="Bearer expired-access"
   ?{code:"UNAUTHORIZED"}:{accountMode:"e2ee",vaultMode:"active"}),{status:options.headers.Authorization==="Bearer expired-access"?401:200});
 };
 const f=fixture(send);
 const transport=createTransport({endpoint:"http://127.0.0.1:4033",token:f.session.current,renewToken:f.session.renew,fetch:send});
 assert.equal((await transport.accountStatus()).accountMode,"e2ee");
 assert.deepEqual(calls.map(item=>item.path),["/v3/vault/status","/v1/auth/refreshToken","/v3/vault/status"]);
 assert.equal(calls[2].authorization,"Bearer new-access");
 assert.equal(f.row.refresh_token,"new-refresh");assert.equal(f.writes,1);
 assert.deepEqual(f.notifications,[{accessToken:"new-access",refreshToken:"new-refresh"}]);
});

test("failed refresh does not overwrite stored tokens and remains unauthorized",async()=>{
 const send=async(url)=>new Response(JSON.stringify({code:"UNAUTHORIZED"}),{status:401});
 const f=fixture(send),transport=createTransport({endpoint:"http://127.0.0.1:4033",
  token:f.session.current,renewToken:f.session.renew,fetch:send});
 await assert.rejects(transport.accountStatus(),error=>error.message==="UNAUTHORIZED");
 assert.equal(f.writes,0);assert.equal(f.row.access_token,"expired-access");
});

test("concurrent v3 401 responses share one token rotation",async()=>{
 let refreshes=0;
 const send=async(url,options)=>{
  if(new URL(url).pathname==="/v1/auth/refreshToken"){refreshes++;
   return new Response(JSON.stringify({access_token:{token:"new-access"},refresh_token:{token:"new-refresh"}}),{status:200});}
  return new Response(JSON.stringify(options.headers.Authorization==="Bearer expired-access"
   ?{code:"UNAUTHORIZED"}:{accountMode:"e2ee"}),{status:options.headers.Authorization==="Bearer expired-access"?401:200});
 };
 const f=fixture(send),transport=createTransport({endpoint:"http://127.0.0.1:4033",
  token:f.session.current,renewToken:f.session.renew,fetch:send});
 await Promise.all([transport.accountStatus(),transport.accountStatus()]);
 assert.equal(refreshes,1);assert.equal(f.writes,1);
});
