const {test}=require("node:test"),assert=require("node:assert/strict");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership");
test("recovery authority replaces devices and authority but rejects replay and device signatures",async()=>{
 const owner=await p.createDevice(),recovery=await p.createDevice(),fresh=await p.createDevice(),nextRecovery=await p.createDevice();
 const d=(id,device)=>({id,role:"write",canAuthorizeDevices:true,signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey});
 const body={schema:1,vaultId:"fixture",recoveryKey:recovery.signing.publicKey,owner:d("owner",owner)};
 const state=await m.verifyGenesis({body,signature:await p.sign(owner.signing.privateKey,"genesis",body)},p.fingerprint(body));
 const event={vaultId:"fixture",revision:1,previous:state.head,operation:"recover",keyGeneration:2,recoveryKey:nextRecovery.signing.publicKey,devices:[d("fresh",fresh)]};
 await assert.rejects(m.applyRecovery(state,{body:event,signature:await p.sign(owner.signing.privateKey,"recovery",event)}));
 const record={body:event,signature:await p.sign(recovery.signing.privateKey,"recovery",event)};
 const next=await m.applyRecovery(state,record);assert.equal(next.devices.has("owner"),false);assert.equal(next.devices.has("fresh"),true);assert.equal(next.keyGeneration,2);
 assert.equal(state.devices.has("owner"),true);await assert.rejects(m.applyRecovery(next,record));
 const add={vaultId:"fixture",revision:2,previous:next.head,operation:"add",signer:"fresh",device:d("owner",owner)};
 await assert.rejects(m.applyMembership(next,{body:add,signature:await p.sign(fresh.signing.privateKey,"membership",add)}),/DUPLICATE/);
});
