const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership"),flow=require("../public/electron/e2ee/filePairing"),owner=require("../public/electron/e2ee/ownerIdentity");
const {EncryptedStore}=require("../public/electron/e2ee/localStore");
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-file-pair-")),scope={environment:"development",accountId:"fixture",vaultId:"fixture"},key=Buffer.alloc(32,5);
 const authority=new EncryptedStore({filename:path.join(dir,"owner.db"),key,scope,create:true});let recipient=new EncryptedStore({filename:path.join(dir,"recipient.db"),key,scope,create:true});
 t.after(()=>{authority.close();recipient.close();fs.rmSync(dir,{recursive:true,force:true});});
 await owner.prepareOwner(authority);const kit=owner.recoveryMaterial(authority);await owner.confirmOwnerRecovery(authority,kit.code,kit.bytes);
 const identity=authority.get("recovery","$owner-identity"),events=[];let state=await m.verifyGenesis(identity.genesis,identity.fingerprint);
 const transport={membership:async(after=0)=>({genesis:p.encode(identity.genesis).toString("base64"),head:{vaultId:"fixture",revision:state.revision,digest:state.head},records:events.filter(e=>e.body.revision>after).map(e=>p.encode(e).toString("base64")),next:state.revision,more:false}),
  approve:async event=>{const prior=events.find(e=>e.body.revision===event.body.revision);if(prior){assert.deepEqual(prior,event);return;}state=await m.applyMembership(state,event);events.push(event);}};
 return {authority,get recipient(){return recipient;},transport,identity,events,
  reopen(){recipient.close();recipient=new EncryptedStore({filename:path.join(dir,"recipient.db"),key,scope});}};
}
test("two encrypted stores exchange request and approved transfer, retaining original keys on repeat",async t=>{
 const f=await fixture(t),options={store:f.recipient,transport:f.transport,fingerprint:f.identity.fingerprint};
 const request=await flow.createRecipientRequest(options),bytes=await flow.requestFile(f.recipient);
 assert.deepEqual(await flow.createRecipientRequest(options),request);
 const preview=await flow.previewRequest(f.authority,bytes);
 await assert.rejects(flow.approveRequest({store:f.authority,transport:f.transport,requestId:preview.requestId,fingerprint:"0".repeat(64),reauthenticate:async()=>true}));
 const transfer=await flow.approveRequest({store:f.authority,transport:f.transport,requestId:preview.requestId,fingerprint:preview.fingerprint,reauthenticate:async()=>true});
 f.reopen();
 const result=await flow.acceptFile({store:f.recipient,transport:f.transport,bytes:transfer});
 assert.equal(result.phase,"PAIRED");
 assert.deepEqual(f.recipient.get("recovery","$paired-device").keyring,f.identity.keyring);
 assert.deepEqual(await flow.acceptFile({store:f.recipient,transport:f.transport,bytes:transfer}),result);
 assert.deepEqual(f.authority.get("recovery","$owner-identity"),f.identity);
 assert.equal(f.events.length,1);
 f.transport.membership=async()=>({genesis:p.encode(f.identity.genesis).toString("base64"),head:{vaultId:"fixture",revision:0,digest:f.identity.fingerprint},records:[],next:0,more:false});
 await assert.rejects(flow.acceptFile({store:f.recipient,transport:f.transport,bytes:transfer}),/MEMBERSHIP_ROLLBACK/);
});
test("wrong pin, expired request and uncommitted approval do not install keys",async t=>{
 const f=await fixture(t);
 await assert.rejects(flow.createRecipientRequest({store:f.recipient,transport:f.transport,fingerprint:"0".repeat(64)}),/PIN/);
 const request=await flow.createRecipientRequest({store:f.recipient,transport:f.transport,fingerprint:f.identity.fingerprint});
 await assert.rejects(flow.requestFile(f.recipient,request.expiresAt+1));
 const preview=await flow.previewRequest(f.authority,await flow.requestFile(f.recipient));
 const pair=require("../public/electron/e2ee/pairing"),rawRequest=f.authority.get("recovery","$pair-preview-"+preview.requestId);
 const proposed=await pair.proposeApproval({request:rawRequest,state:await m.verifyGenesis(f.identity.genesis,f.identity.fingerprint),authority:f.identity.device,authorityId:f.identity.deviceId,keyring:f.identity.keyring,confirmedFingerprint:preview.fingerprint,reauthenticate:async()=>true});
 await assert.rejects(flow.acceptFile({store:f.recipient,transport:f.transport,bytes:pair.toTransferFile(proposed.transfer)}),/APPROVAL_NOT_COMMITTED/);
 await assert.rejects(flow.approveRequest({store:f.authority,transport:f.transport,requestId:preview.requestId,fingerprint:preview.fingerprint,reauthenticate:async()=>false}),/REAUTH/);
 assert.equal(f.recipient.get("recovery","$paired-device"),null);assert.equal(f.events.length,0);
});
