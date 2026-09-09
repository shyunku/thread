const {test}=require("node:test");const assert=require("node:assert/strict");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership"),pair=require("../public/electron/e2ee/pairing");
async function fixture(){
 const owner=await p.createDevice(),recipient=await p.createDevice();
 const body={schema:1,vaultId:"pair-fixture",recoveryKey:Buffer.alloc(32,1),owner:{id:"owner",role:"write",canAuthorizeDevices:true,signingKey:owner.signing.publicKey,encryptionKey:owner.encryption.publicKey}};
 const genesisFingerprint=p.fingerprint(body);const state=await m.verifyGenesis({body,signature:await p.sign(owner.signing.privateKey,"genesis",body)},genesisFingerprint);
 const request=await pair.createRequest({vaultId:state.vaultId,genesisFingerprint,device:recipient,now:100000});
 const options={request,state,authority:owner,authorityId:"owner",keyring:{generation:1,key:Buffer.alloc(32,9)},confirmedFingerprint:pair.requestFingerprint(request),reauthenticate:async()=>true,now:()=>100001};
 return {state,recipient,request,options,genesisFingerprint};
}
test("request file/QR roundtrip and recipient-only signed transfer",async()=>{
 const f=await fixture();assert.deepEqual(await pair.fromQR(pair.toQR(f.request),100001),f.request);
 assert.deepEqual(await pair.fromRequestFile(pair.toRequestFile(f.request),100001),f.request);
 const result=await pair.proposeApproval(f.options),bytes=pair.toTransferFile(result.transfer);
 assert.equal(bytes.includes(Buffer.alloc(32,9)),false);
 const received=await pair.acceptTransfer({bytes,request:f.request,device:f.recipient,state:f.state,genesisFingerprint:f.genesisFingerprint,now:100002});
 assert.deepEqual(received.keyring,f.options.keyring);assert.equal(received.state.devices.get(f.request.body.device.id).role,"read");
 await assert.rejects(pair.acceptTransfer({bytes,request:f.request,device:f.recipient,state:received.state,genesisFingerprint:f.genesisFingerprint,now:100003}),/CHAIN/);
});
test("requires fingerprint confirmation, reauthentication and matching genesis",async()=>{
 const f=await fixture();await assert.rejects(pair.proposeApproval({...f.options,confirmedFingerprint:"wrong"}),/INVALID/);
 await assert.rejects(pair.proposeApproval({...f.options,reauthenticate:async()=>false}),/REAUTH/);
 await assert.rejects(pair.proposeApproval({...f.options,state:{...f.state,genesisFingerprint:"0".repeat(64)}}),/INVALID/);
 await assert.rejects(pair.proposeApproval({...f.options,now:()=>700000}),/INVALID/);
});
test("rejects substitution, tampering, expired response and wrong recipient",async()=>{
 const f=await fixture();const result=await pair.proposeApproval(f.options),bytes=pair.toTransferFile(result.transfer);
 const options={bytes,request:f.request,device:f.recipient,state:f.state,genesisFingerprint:f.genesisFingerprint,now:100002};
 await assert.rejects(pair.acceptTransfer({...options,device:await p.createDevice()}));
 await assert.rejects(pair.acceptTransfer({...options,now:700000}));
 const changed=p.decode(bytes);changed.sealed.body.ciphertext[0]^=1;
 await assert.rejects(pair.acceptTransfer({...options,bytes:p.encode(changed)}));
 const request=p.decode(pair.toRequestFile(f.request));request.body.device.canAuthorizeDevices=true;
 await assert.rejects(pair.verifyRequest(request,100002));
 await assert.rejects(pair.fromRequestFile(Buffer.alloc(2049),100002));
});
