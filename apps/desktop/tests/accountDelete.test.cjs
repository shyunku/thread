const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{EventEmitter}=require("node:events");
const {deleteAccount}=require("../public/electron/e2ee/accountSessions");
const {createTokenSession}=require("../public/electron/e2ee/tokenSession");
const {createTransport}=require("../public/electron/e2ee/transport");
const {VaultWorkspaceService}=require("../public/electron/e2ee/workspaceService");
const {vaultIpcReply}=require("../public/electron/e2ee/vaultIpcReply");
const {REQUEST_TOPICS,EVENT_TOPICS}=require("../public/electron/modules/preload");

// Account deletion (#92). Synthetic server answers only; no real account or network.
const endpoint="https://api.fixture.invalid/";
const json=(status,code)=>new Response(code?JSON.stringify({code}):null,{status});
function server(responses){
 const calls=[];
 const send=async(url,init)=>{
  calls.push({url,method:init.method,headers:init.headers,body:init.body&&JSON.parse(init.body)});
  const next=responses.shift();
  if(next instanceof Error)throw next;
  return typeof next==="function"?next(url,init):json(next.status,next.code);
 };
 return {calls,send};
}
const tokens=(renew=async()=>"access-2")=>{const renewed=[];return {renewed,current:async()=>"access-1",renew:async stale=>{renewed.push(stale);return renew(stale);}};};

test("deleteAccount posts {} with the access token and answers true on 204",async()=>{
 const s=server([{status:204}]),t=tokens();
 assert.equal(await deleteAccount({endpoint,tokens:t,fetch:s.send}),true);
 assert.equal(s.calls[0].url,"https://api.fixture.invalid/v1/auth/account/delete");
 assert.equal(s.calls[0].method,"POST");
 assert.equal(s.calls[0].headers.Authorization,"Bearer access-1");
 assert.deepEqual(s.calls[0].body,{});
 assert.deepEqual(t.renewed,[]);
});

test("deleteAccount renews an expired token once and maps the server's refusals",async()=>{
 const retry=server([{status:401},{status:204}]),t=tokens();
 assert.equal(await deleteAccount({endpoint,tokens:t,fetch:retry.send}),true);
 assert.deepEqual(t.renewed,["access-1"]);
 assert.equal(retry.calls[1].headers.Authorization,"Bearer access-2");
 await assert.rejects(deleteAccount({endpoint,tokens:tokens(),fetch:server([{status:401},{status:401}]).send}),/^Error: UNAUTHORIZED$/);
 await assert.rejects(deleteAccount({endpoint,tokens:tokens(),fetch:server([{status:403,code:"ADMIN_ACCOUNT"}]).send}),/ACCOUNT_DELETE_FORBIDDEN/);
 await assert.rejects(deleteAccount({endpoint,tokens:tokens(),fetch:server([{status:503,code:"ACCOUNT_DELETE_UNAVAILABLE"}]).send}),/ACCOUNT_DELETE_UNAVAILABLE/);
 await assert.rejects(deleteAccount({endpoint,tokens:{current:async()=>null},fetch:()=>assert.fail("no token, no request")}),/AUTH_REQUIRED/);
 await assert.rejects(deleteAccount({endpoint:"http://api.fixture.invalid/",tokens:tokens(),fetch:()=>assert.fail("insecure")}),/INSECURE_SESSION_ENDPOINT/);
 // A renewal that says the account is gone means an earlier attempt went through.
 const gone=tokens(async()=>{throw Error("ACCOUNT_DELETED");});
 assert.equal(await deleteAccount({endpoint,tokens:gone,fetch:server([{status:401}]).send}),true);
 const other=tokens(async()=>{throw Error("UNAUTHORIZED");});
 await assert.rejects(deleteAccount({endpoint,tokens:other,fetch:server([{status:401}]).send}),/UNAUTHORIZED/);
});

function tokenFixture(send,deleted){
 const row={access_token:"expired-access",refresh_token:"valid-refresh"};let writes=0;
 const database=async()=>({db:{get:(_s,_a,cb)=>cb(null,{...row}),run:(_s,_a,cb)=>{writes++;cb.call({changes:1},null);}}});
 const session=createTokenSession({database,uid:"fixture",endpoint:"http://127.0.0.1:4033",send,signal:new AbortController().signal,active:()=>{},deleted});
 return {session,get writes(){return writes;}};
}

test("a refresh answered with ACCOUNT_DELETED reports it once and passes through the transport",async()=>{
 let notified=0;
 const send=async url=>new URL(url).pathname==="/v1/auth/refreshToken"?json(401,"ACCOUNT_DELETED"):json(401,"UNAUTHORIZED");
 const f=tokenFixture(send,()=>notified++);
 const transport=createTransport({endpoint:"http://127.0.0.1:4033",token:f.session.current,renewToken:f.session.renew,fetch:send});
 await assert.rejects(transport.accountStatus(),error=>error.message==="ACCOUNT_DELETED");
 assert.equal(notified,1);assert.equal(f.writes,0);
 // Any other refusal stays UNAUTHORIZED and is not a deletion.
 let other=0;
 const g=tokenFixture(async()=>json(401,"REFRESH_REUSED"),()=>other++);
 await assert.rejects(g.session.renew("expired-access"),/UNAUTHORIZED/);
 const h=tokenFixture(async()=>json(403,"ACCOUNT_DELETED"),()=>other++);
 await assert.rejects(h.session.renew("expired-access"),/UNAUTHORIZED/);
 assert.equal(other,0);
});

// Synthetic vault workspace with a fake root database, server and window.
function workspace(t,{osAvailable=true,respond}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-account-delete-")),window=new EventEmitter(),power=new EventEmitter();
 window.webContents=new EventEmitter();power.getSystemIdleTime=()=>0;
 const state={account:"fixture",users:new Map([["fixture",{access_token:"access-1",refresh_token:"refresh-1"}],["other",{access_token:"o",refresh_token:"o"}]]),
  sent:[],removed:[],requests:[]};
 const osAuth={answer:async()=>true,availability:async()=>osAvailable,verify:async()=>osAuth.answer()};
 const root={
  db:{get:(_sql,[uid],cb)=>cb(null,state.users.get(uid)&&{...state.users.get(uid)}),
   run:(_sql,args,cb)=>{const row=state.users.get(args[2]);Object.assign(row,{access_token:args[0],refresh_token:args[1]});cb.call({changes:1},null);}},
  run:async(sql,args)=>{assert.match(sql,/^DELETE FROM users WHERE uid = \?;$/);state.users.delete(args[0]);},
 };
 const fetch=async(url,init)=>{state.requests.push({path:new URL(url).pathname,authorization:init.headers.Authorization,body:init.body});return respond(new URL(url).pathname,init);};
 const deps={enabled:true,baseDirectory:dir,environment:"development",getAccount:()=>state.account,getWindow:()=>window,powerMonitor:power,
  protector:{protect:key=>Buffer.from(key),unprotect:bytes=>Buffer.from(bytes)},osAuth,notify:()=>{},fetch,endpoint,retryDelay:0};
 const service=new VaultWorkspaceService(deps);
 service.inject({databaseService:{getRootDatabaseContext:async()=>root,removeUserDatabases:async uid=>state.removed.push(uid)},
  ipcService:{sender:(...args)=>state.sent.push(args)},userService:{getCurrent:()=>state.account}});
 service.userService={getCurrent:()=>state.account};
 t.after(()=>{service.reset();fs.rmSync(dir,{recursive:true,force:true});});
 return {service,state,osAuth,dir};
}
const PASSWORD="synthetic delete password";
const vaultDirs=dir=>fs.readdirSync(dir).filter(name=>/^[a-f0-9]{64}$/.test(name));

test("deleteAccount confirms the user, deletes on the server and removes only this account's local data",async t=>{
 const f=workspace(t,{respond:path=>path==="/v1/auth/account/delete"?json(204):json(404)}),s=f.service;
 // Another account's vault on the same PC stays.
 f.state.account="other";await s.create({method:"os"});f.state.account="fixture";
 await s.create({method:"os"});await s.unlock("os");
 assert.equal(vaultDirs(f.dir).length,2);
 const reply=await vaultIpcReply(s,"vault/deleteAccount",input=>s.deleteAccount(input),[{method:"os"}]);
 assert.deepEqual(reply,{success:true,data:{deleted:true}});
 assert.deepEqual(f.state.requests.map(r=>r.path),["/v1/auth/account/delete"]);
 assert.equal(f.state.requests[0].authorization,"Bearer access-1");
 assert.equal(vaultDirs(f.dir).length,1);
 assert.equal(s.vaultFor("fixture").inspect().phase,"ABSENT");
 assert.equal(s.vaultFor("other").inspect().phase,"LOCKED");
 assert.deepEqual([...f.state.users.keys()],["other"]);
 assert.deepEqual(f.state.removed,["fixture"]);
 // Deleted here: no "deleted elsewhere" event.
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(f.state.sent.filter(args=>args[0]==="auth/accountDeleted").length,0);
});

test("a refused identity check or a server error deletes nothing",async t=>{
 let answer=json(503,"ACCOUNT_DELETE_UNAVAILABLE");
 const f=workspace(t,{respond:()=>answer}),s=f.service;
 await s.create(PASSWORD);await s.unlock("password",PASSWORD);
 f.osAuth.answer=async()=>{throw Error("OS_AUTH_CANCELLED");};
 assert.deepEqual(await s.deleteAccount({method:"os"}),{deleted:false,code:"OS_AUTH_CANCELLED",method:"os",osAvailable:true,passwordAvailable:true});
 assert.equal((await s.deleteAccount({method:"password",password:"wrong"})).code,"PASSWORD_REJECTED");
 assert.equal(f.state.requests.length,0);
 // 503 is retried once, then answered.
 assert.deepEqual(await s.deleteAccount({method:"password",password:PASSWORD}),{deleted:false,code:"ACCOUNT_DELETE_UNAVAILABLE"});
 assert.equal(f.state.requests.length,2);
 answer=json(403,"FORBIDDEN");
 assert.deepEqual(await s.deleteAccount({method:"password",password:PASSWORD}),{deleted:false,code:"ACCOUNT_DELETE_FORBIDDEN"});
 assert.equal(s.vaultFor("fixture").inspect().phase,"LOCKED");
 assert.equal((await s.status()).phase,"UNLOCKED");
 assert.ok(f.state.users.has("fixture"));
 assert.deepEqual(f.state.removed,[]);
 // The second attempt of a lost answer: the session is gone and the refresh says deleted.
 answer=null;
 const g=workspace(t,{respond:p=>p==="/v1/auth/refreshToken"?json(401,"ACCOUNT_DELETED"):json(401,"UNAUTHORIZED")}),u=g.service;
 await u.create({method:"os"});await u.unlock("os");
 assert.deepEqual(await u.deleteAccount({method:"os"}),{deleted:true});
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(u.vaultFor("fixture").inspect().phase,"ABSENT");
 assert.equal(g.state.sent.filter(args=>args[0]==="auth/accountDeleted").length,0);
});

test("a deletion on another device: the next refresh removes this PC's vault and account and tells the window once",async t=>{
 const f=workspace(t,{respond:p=>p==="/v1/auth/refreshToken"?json(401,"ACCOUNT_DELETED"):json(401,"UNAUTHORIZED")}),s=f.service;
 f.state.account="other";await s.create({method:"os"});f.state.account="fixture";
 await s.create({method:"os"});await s.unlock("os");
 const transport=s.transportFor(s.context());
 await assert.rejects(transport.accountStatus(),/ACCOUNT_DELETED/);
 // A second request sees the same answer before the cleanup runs: still one notice.
 await s.transportFor(s.context()).accountStatus().catch(()=>{});
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(s.vaultFor("fixture").inspect().phase,"ABSENT");
 assert.equal(s.vaultFor("other").inspect().phase,"LOCKED");
 assert.deepEqual([...f.state.users.keys()],["other"]);
 assert.deepEqual(f.state.sent.filter(args=>args[0]==="auth/accountDeleted"),[["auth/accountDeleted",null,true,{uid:"fixture"}]]);
});

test("the renderer may ask to delete the account and hear about a deletion elsewhere",()=>{
 assert.ok(REQUEST_TOPICS.includes("vault/deleteAccount"));
 assert.ok(EVENT_TOPICS.includes("auth/accountDeleted"));
});
