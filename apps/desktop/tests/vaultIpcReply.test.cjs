const {test}=require("node:test"),assert=require("node:assert/strict");
const {vaultIpcReply}=require("../public/electron/e2ee/vaultIpcReply");
test("first bootstrap may establish the account and enter migration without a retry",async()=>{
 let uid=null;const service={userService:{getCurrent:()=>uid}};
 const reply=await vaultIpcReply(service,"vault/bootstrap",async requested=>{uid=requested;await Promise.resolve();return {mode:"MIGRATION_REQUIRED"};},["fixture"]);
 assert.deepEqual(reply,{success:true,data:{mode:"MIGRATION_REQUIRED"}});
});
test("bootstrap still rejects a genuinely switched account",async()=>{
 let uid=null,finish;const service={userService:{getCurrent:()=>uid}};
 const pending=vaultIpcReply(service,"vault/bootstrap",requested=>{uid=requested;return new Promise(resolve=>{finish=resolve;});},["fixture"]);
 uid="other";finish({mode:"MIGRATION_REQUIRED"});
 assert.deepEqual(await pending,{success:false,data:{code:"VAULT_SESSION_CHANGED"}});
});
test("non-bootstrap actions retain account isolation and private error redaction",async()=>{
 let uid="fixture";const service={userService:{getCurrent:()=>uid}};
 assert.deepEqual(await vaultIpcReply(service,"vault/getStatus",async()=>{uid="other";return {};},[]),{success:false,data:{code:"VAULT_ACTION_FAILED"}});
 const reply=await vaultIpcReply(service,"vault/bootstrap",async()=>{throw Error("SQL private token fixture");},["other"]);
 assert.deepEqual(reply,{success:false,data:{code:"VAULT_ACTION_FAILED"}});
});
