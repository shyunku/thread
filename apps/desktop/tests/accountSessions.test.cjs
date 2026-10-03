const {test}=require("node:test");
const assert=require("node:assert/strict");
const {logout,revokeOtherSessions}=require("../public/electron/e2ee/accountSessions");

const endpoint="https://api.fixture.invalid/";
function server(responses){
 const calls=[];
 const send=async(url,init)=>{
  calls.push({url,headers:init.headers,body:init.body&&JSON.parse(init.body)});
  const next=responses.shift();
  if(next instanceof Error)throw next;
  return new Response(next.code?JSON.stringify({code:next.code}):null,{status:next.status});
 };
 return {calls,send};
}

test("logout ends the server session with the refresh token and never throws",async()=>{
 const ok=server([{status:204}]);
 assert.equal(await logout({endpoint,refreshToken:"refresh-1",fetch:ok.send}),true);
 assert.equal(ok.calls[0].url,"https://api.fixture.invalid/v1/auth/logout");
 assert.equal(ok.calls[0].headers["X-Refresh-Token"],"refresh-1");
 assert.equal(await logout({endpoint,refreshToken:"refresh-1",fetch:server([Error("offline")]).send}),false);
 assert.equal(await logout({endpoint,refreshToken:null,fetch:()=>assert.fail("no token, no request")}),false);
 assert.equal(await logout({endpoint:"http://api.fixture.invalid/",refreshToken:"refresh-1",fetch:()=>assert.fail("insecure endpoint")}),false);
});

test("revoking other sessions keeps this one and renews an expired or pre-session token once",async()=>{
 const tokens=(renewed=[])=>({current:async()=>"access-1",renew:async stale=>{renewed.push(stale);return "access-2";},renewed});

 const direct=server([{status:204}]),t1=tokens();
 assert.equal(await revokeOtherSessions({endpoint,tokens:t1,fetch:direct.send}),true);
 assert.deepEqual(direct.calls[0].body,{keep_current:true});
 assert.equal(direct.calls[0].headers.Authorization,"Bearer access-1");
 assert.deepEqual(t1.renewed,[]);

 for(const first of [{status:401},{status:409,code:"SESSION_REFRESH_REQUIRED"}]){
  const retry=server([first,{status:204}]),t=tokens();
  assert.equal(await revokeOtherSessions({endpoint,tokens:t,fetch:retry.send}),true);
  assert.deepEqual(t.renewed,["access-1"]);
  assert.equal(retry.calls[1].headers.Authorization,"Bearer access-2");
 }

 await assert.rejects(revokeOtherSessions({endpoint,tokens:tokens(),fetch:server([{status:401},{status:401}]).send}),/UNAUTHORIZED/);
 const down=server([{status:503,code:"SESSION_UNAVAILABLE"}]),t2=tokens();
 await assert.rejects(revokeOtherSessions({endpoint,tokens:t2,fetch:down.send}),/SESSION_UNAVAILABLE/);
 assert.deepEqual(t2.renewed,[]);
 await assert.rejects(revokeOtherSessions({endpoint,tokens:{current:async()=>null},fetch:()=>assert.fail()}),/AUTH_REQUIRED/);
});
