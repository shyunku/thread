const test=require("node:test"),assert=require("node:assert/strict");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership"),r=require("../public/electron/e2ee/recovery");
const {proposeTransition,openTransition}=require("../public/electron/e2ee/keyTransition");
const descriptor=(id,d)=>({id,signingKey:d.signing.publicKey,encryptionKey:d.encryption.publicKey,role:"write",canAuthorizeDevices:true});
async function fixture(){
 const owner=await p.createDevice(),other=await p.createDevice(),authority=await p.createDevice();
 const body={schema:1,vaultId:"fixture",recoveryKey:authority.signing.publicKey,owner:descriptor("owner",owner)};
 let state=await m.verifyGenesis({body,signature:await p.sign(owner.signing.privateKey,"genesis",body)},p.fingerprint(body));
 const event={vaultId:state.vaultId,revision:1,previous:state.head,signer:"owner",operation:"add",device:descriptor("other",other)};
 state=await m.applyMembership(state,{body:event,signature:await p.sign(owner.signing.privateKey,"membership",event)});
 return {state,owner,other,authority,keys:[{generation:1,key:Buffer.alloc(32,7)}]};
}
test("rotation delivers all retained keys only to survivors and renews recovery authority",async()=>{
 const f=await fixture(),proposal=await proposeTransition({...f,epoch:"1",deviceId:"owner",device:f.owner,recipients:[descriptor("owner",f.owner)]});
 const opened=await openTransition({state:f.state,record:proposal.record,epoch:"1",deviceId:"owner",device:f.owner,knownKeys:f.keys});
 assert.equal(opened.state.keyGeneration,2);assert.equal(opened.keyring.keys.length,2);
 assert.notDeepEqual(opened.state.recoveryKey,f.state.recoveryKey);
 await assert.rejects(openTransition({state:f.state,record:proposal.record,epoch:"1",deviceId:"other",device:f.other}),/REVOKED/);
 const recovered=await r.recover(proposal.recovery.secret,proposal.recovery.bundle,{vaultId:f.state.vaultId,genesisFingerprint:f.state.genesisFingerprint});
 assert.deepEqual(recovered.keyring.keys,proposal.keyring.keys);
 await assert.rejects(m.applyTransition(opened.state,proposal.record));
});
test("recovery replaces devices; wrong authority and missing recipient envelope fail",async()=>{
 const f=await fixture(),fresh=await p.createDevice(),options={...f,epoch:"1",operation:"recover",recoveryAuthoritySecret:f.authority.signing.privateKey,recipients:[descriptor("fresh",fresh)]};
 const proposal=await proposeTransition(options);
 assert.equal(proposal.state.devices.size,1);assert.ok(proposal.state.devices.has("fresh"));
 await assert.rejects(proposeTransition({...options,recoveryAuthoritySecret:f.owner.signing.privateKey}),/SIGNATURE/);
 await assert.rejects(proposeTransition({...options,recipients:[descriptor("owner",f.owner)]}),/KEY_REUSE/);
 await assert.rejects(m.applyTransition(f.state,{...proposal.record,body:{...proposal.record.body,envelopes:[]}}));
});
