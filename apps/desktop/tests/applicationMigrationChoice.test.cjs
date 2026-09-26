const {test}=require("node:test"),assert=require("node:assert/strict");
const {bootstrap,chooseMigration}=require("../public/electron/e2ee/applicationBootstrap");

function fixture(caps={protocolVersion:2,mode:"v2",enabled:true,migrationAvailable:true}){
 const calls=[];
 const session={running:false,mutating:0,replica:{close:async()=>calls.push("close")}};
 const sync={sessions:new Map([["account",session]]),opening:new Map(),stop:()=>calls.push("stop")};
 const entry={uid:"account",unlocked:false,abort:new AbortController(),vault:{inspect:()=>({phase:"ABSENT"})}};
 const service={busy:false,active:entry,runtime:()=>({getAccount:()=>"account"}),context:()=>entry,
  transportFor:()=>({legacyCapabilities:async()=>caps}),group:{syncV2Service:sync}};
 return {service,entry,session,sync,calls};
}
test("v2 migration closes the old session before opening setup",async()=>{
 const f=fixture();
 assert.deepEqual(await chooseMigration(f.service,"account"),{mode:"MIGRATION_REQUIRED",migrationPending:true});
 assert.deepEqual(f.calls,["stop","close"]);
 assert.equal(f.sync.sessions.has("account"),false);
 assert.equal(f.entry.migrationIntent,true);
 assert.equal(f.entry.migrationActive,true);
});
test("unavailable migration or busy v2 session never opens legacy home",async()=>{
 const unavailable=fixture({protocolVersion:2,mode:"v2",enabled:true,migrationAvailable:false});
 await assert.rejects(chooseMigration(unavailable.service,"account"),/MIGRATION_UNAVAILABLE/);
 assert.deepEqual(unavailable.calls,[]);
 assert.equal(unavailable.sync.sessions.has("account"),true);
 const busy=fixture();busy.session.running=true;
 await assert.rejects(chooseMigration(busy.service,"account"),/VAULT_BUSY/);
 assert.deepEqual(busy.calls,[]);
 assert.equal(busy.entry.migrationIntent,undefined);
});
test("v2-compatible server enters migration before mounting any home",async()=>{
 const f=fixture();
 f.service.generation=0;
 f.service.group.userService={setCurrent:()=>{}};
 f.service.transportFor=()=>({accountStatus:async()=>{throw Error("VAULT_NOT_FOUND");},legacyCapabilities:async()=>({protocolVersion:2,mode:"v2",enabled:true,migrationAvailable:true})});
 assert.deepEqual(await bootstrap(f.service,"account"),{mode:"MIGRATION_REQUIRED",migrationPending:true});
 assert.deepEqual(f.calls,["stop","close"]);
 assert.equal(f.sync.sessions.has("account"),false);
});
