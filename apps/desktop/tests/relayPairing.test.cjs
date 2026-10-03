const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {randomBytes}=require("node:crypto");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership"),owner=require("../public/electron/e2ee/ownerIdentity");
const {EncryptedStore}=require("../public/electron/e2ee/localStore");
const {OwnerRelay,RecipientRelay,sasCode,commitment}=require("../public/electron/e2ee/relayPairing");

// The server relay as seen by the devices: JSON with base64 bytes, write-once steps.
function relayServer(){
 let session=null;
 const b64=value=>value?Buffer.from(value).toString("base64"):undefined;
 const need=(id)=>{if(!session||session.sessionId!==id)throw Error("PAIRING_NOT_FOUND");};
 return {
  get session(){return session;},set session(value){session=value;},
  pairingCreate:async({vaultId,fingerprint,commitment})=>{session={sessionId:randomBytes(16).toString("hex"),vaultId,fingerprint,commitment,expiresAt:Date.now()+600000};return {sessionId:session.sessionId,expiresAt:session.expiresAt};},
  pairingSession:async()=>{if(!session)throw Error("PAIRING_NOT_FOUND");return {sessionId:session.sessionId,vaultId:session.vaultId,fingerprint:session.fingerprint,expiresAt:session.expiresAt,
   commitment:b64(session.commitment),request:b64(session.request),nonceN:b64(session.nonceN),nonceE:b64(session.nonceE),transfer:b64(session.transfer)};},
  pairingRequest:async({sessionId,request,nonce})=>{need(sessionId);if(session.request)throw Error("PAIRING_CONFLICT");session.request=request;session.nonceN=nonce;return null;},
  pairingReveal:async({sessionId,nonce})=>{need(sessionId);if(!session.request||session.nonceE)throw Error("PAIRING_CONFLICT");session.nonceE=nonce;return null;},
  pairingTransfer:async({sessionId,transfer})=>{need(sessionId);if(!session.nonceE||session.transfer)throw Error("PAIRING_CONFLICT");session.transfer=transfer;return null;},
  pairingCancel:async({sessionId})=>{if(session?.sessionId===sessionId)session=null;return null;},
 };
}

async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-relay-pair-")),scope={environment:"development",accountId:"fixture",vaultId:"fixture"},key=Buffer.alloc(32,5);
 const authority=new EncryptedStore({filename:path.join(dir,"owner.db"),key,scope,create:true});
 const recipient=new EncryptedStore({filename:path.join(dir,"recipient.db"),key,scope,create:true});
 const attacker=new EncryptedStore({filename:path.join(dir,"attacker.db"),key,scope,create:true});
 t.after(()=>{authority.close();recipient.close();attacker.close();fs.rmSync(dir,{recursive:true,force:true});});
 await owner.prepareOwner(authority);const kit=owner.recoveryMaterial(authority);await owner.confirmOwnerRecovery(authority,kit.code,kit.bytes);
 const identity=authority.get("recovery","$owner-identity"),events=[];let state=await m.verifyGenesis(identity.genesis,identity.fingerprint);
 const relay=relayServer();
 const transport={...relay,
  membership:async(after=0)=>({genesis:p.encode(identity.genesis).toString("base64"),head:{vaultId:"fixture",revision:state.revision,digest:state.head},records:events.filter(e=>e.body.revision>after).map(e=>p.encode(e).toString("base64")),next:state.revision,more:false}),
  approve:async event=>{const prior=events.find(e=>e.body.revision===event.body.revision);if(prior){assert.deepEqual(prior,event);return;}state=await m.applyMembership(state,event);events.push(event);}};
 Object.defineProperty(transport,"session",{get:()=>relay.session,set:value=>{relay.session=value;}});
 return {authority,recipient,attacker,transport,identity,events};
}

test("devices connect through the relay after both confirm the same 6-digit code",async t=>{
 const f=await fixture(t);
 const ownerRelay=new OwnerRelay({store:f.authority,transport:f.transport}),newDevice=new RecipientRelay({store:f.recipient,transport:f.transport});
 assert.equal((await newDevice.poll()).phase,"WAITING"); // no session yet
 assert.equal((await ownerRelay.start()).phase,"WAITING");
 assert.equal((await newDevice.poll()).phase,"CONNECTING");
 const ownerView=await ownerRelay.poll();
 assert.equal(ownerView.phase,"COMPARE");assert.match(ownerView.code,/^\d{6}$/);assert.equal(ownerView.role,"write");
 const deviceView=await newDevice.poll();
 assert.equal(deviceView.phase,"COMPARE");assert.equal(deviceView.code,ownerView.code);

 // The approval arrives, but the new device installs nothing until the user confirms.
 await assert.rejects(ownerRelay.approve(async()=>false),/REAUTH/);
 assert.equal((await ownerRelay.approve(async()=>true)).phase,"DONE");
 assert.equal((await newDevice.poll()).phase,"COMPARE");
 assert.equal(f.recipient.get("recovery","$paired-device"),null);
 assert.equal(newDevice.confirm().phase,"APPROVAL");
 assert.equal((await newDevice.poll()).phase,"PAIRED");
 assert.deepEqual(f.recipient.get("recovery","$paired-device").keyring,f.identity.keyring);
 assert.equal(f.events.length,1);
 assert.equal(f.transport.session,null); // cleaned up
});

test("a relay that swaps the request shows different codes and installs nothing",async t=>{
 const f=await fixture(t);
 const ownerRelay=new OwnerRelay({store:f.authority,transport:f.transport}),newDevice=new RecipientRelay({store:f.recipient,transport:f.transport});
 await ownerRelay.start();
 await newDevice.poll();
 // The relay replaces the new device's request with one from a device it controls.
 const intruder=new RecipientRelay({store:f.attacker,transport:{...f.transport,pairingRequest:async({request,nonce})=>{f.transport.session.request=request;f.transport.session.nonceN=nonce;return null;}}});
 const genuine={...f.transport.session};f.transport.session={...genuine,request:undefined,nonceN:undefined};
 await intruder.poll();
 const ownerView=await ownerRelay.poll();
 f.transport.session={...f.transport.session,request:genuine.request,nonceN:genuine.nonceN};
 const deviceView=await newDevice.poll();
 assert.equal(ownerView.phase,"COMPARE");assert.equal(deviceView.phase,"COMPARE");
 assert.notEqual(ownerView.code,deviceView.code);
 assert.equal(f.recipient.get("recovery","$paired-device"),null);assert.equal(f.events.length,0);
});

test("a relay that forges the reveal is caught by the commitment",async t=>{
 const f=await fixture(t);
 const ownerRelay=new OwnerRelay({store:f.authority,transport:f.transport}),newDevice=new RecipientRelay({store:f.recipient,transport:f.transport});
 await ownerRelay.start();await newDevice.poll();
 f.transport.session.nonceE=randomBytes(32);
 assert.equal((await newDevice.poll()).phase,"MISMATCH");
 assert.equal(f.transport.session,null);
 assert.equal(f.recipient.get("recovery","$paired-device"),null);
});

test("a relay that points the new device at another vault fails before any request",async t=>{
 const f=await fixture(t);
 const ownerRelay=new OwnerRelay({store:f.authority,transport:f.transport}),newDevice=new RecipientRelay({store:f.recipient,transport:f.transport});
 await ownerRelay.start();
 f.transport.session.fingerprint="ab".repeat(32);
 await assert.rejects(newDevice.poll(),/GENESIS|PIN|MEMBERSHIP|FINGERPRINT/);
 assert.equal(f.transport.session.request,undefined);
});

test("the code depends on every value and has six digits",()=>{
 const base={fingerprint:"a".repeat(64),requestFingerprint:"b".repeat(64),nonceE:Buffer.alloc(32,1),nonceN:Buffer.alloc(32,2)};
 const code=sasCode(base);assert.match(code,/^\d{6}$/);
 for(const change of [{fingerprint:"c".repeat(64)},{requestFingerprint:"d".repeat(64)},{nonceE:Buffer.alloc(32,3)},{nonceN:Buffer.alloc(32,4)}])
  assert.notEqual(sasCode({...base,...change}),code);
 assert.equal(commitment(Buffer.alloc(32,1)).length,32);
});
