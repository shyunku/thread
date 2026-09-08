const {test}=require("node:test");
const assert=require("node:assert/strict");
const p=require("../public/electron/e2ee/protocol");
const m=require("../public/electron/e2ee/membership");
test("genesis pin, chain, mobile read role and mutation replay",async()=>{
 const owner=await p.createDevice(), mobile=await p.createDevice();
 const body={schema:1,vaultId:"synthetic",recoveryKey:Buffer.alloc(32,7),
 owner:{id:"owner",role:"write",canAuthorizeDevices:true,signingKey:owner.signing.publicKey,encryptionKey:owner.encryption.publicKey}};
 const genesis={body,signature:await p.sign(owner.signing.privateKey,"genesis",body)};
 await assert.rejects(m.verifyGenesis(genesis,"wrong"),/PIN/);
 const initial=await m.verifyGenesis(genesis,p.fingerprint(body));
 const event={vaultId:"synthetic",revision:1,previous:initial.head,signer:"owner",operation:"add",
 device:{id:"mobile",role:"read",canAuthorizeDevices:false,signingKey:mobile.signing.publicKey,encryptionKey:mobile.encryption.publicKey}};
 const record={body:event,signature:await p.sign(owner.signing.privateKey,"membership",event)};
 const state=await m.applyMembership(initial,record);
 await assert.rejects(m.applyMembership(state,record),/CHAIN/);
 const mutation={vaultId:"synthetic",membershipRevision:1,deviceId:"mobile",counter:"1"};
 await assert.rejects(m.verifyMutation(state,{body:mutation,signature:await p.sign(mobile.signing.privateKey,"mutation",mutation)},"0"),/WRITE_FORBIDDEN/);
 mutation.deviceId="owner";
 const signed={body:mutation,signature:await p.sign(owner.signing.privateKey,"mutation",mutation)};
 assert.equal((await m.verifyMutation(state,signed,"0")).counter,"1");
 await assert.rejects(m.verifyMutation(state,signed,"1"),/REPLAY/);
 assert.equal(initial.devices.size,1);
});
