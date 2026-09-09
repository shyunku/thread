const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const p=require("../public/electron/e2ee/protocol"),pair=require("../public/electron/e2ee/pairing"),m=require("../public/electron/e2ee/membership");
const {MembershipHistory}=require("../public/electron/e2ee/readProtocol"),{EncryptedStore}=require("../public/electron/e2ee/localStore"),{PairingCoordinator}=require("../public/electron/e2ee/pairingCoordinator");
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-pair-coordinator-")),filename=path.join(dir,"vault.db"),key=Buffer.alloc(32,1),scope={environment:"development",accountId:"fixture",vaultId:"fixture"};
 let store=new EncryptedStore({filename,key,scope,create:true});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const owner=await p.createDevice(),device=await p.createDevice(),body={schema:1,vaultId:"fixture",recoveryKey:Buffer.alloc(32,2),owner:{id:"owner",role:"write",canAuthorizeDevices:true,signingKey:owner.signing.publicKey,encryptionKey:owner.encryption.publicKey}};
 const genesis={body,signature:await p.sign(owner.signing.privateKey,"genesis",body)},pin=p.fingerprint(body),history=await new MembershipHistory(genesis,pin).initialize();
 const request=await pair.createRequest({vaultId:"fixture",genesisFingerprint:pin,device,now:100000}),events=[];let remote=history.current,lose=false;
 const transport={approve:async event=>{
  if(events.length)assert.deepEqual(event,events[0]);else{remote=await m.applyMembership(remote,event);events.push(event);}
  if(lose){lose=false;throw Error("LOST_ACK");}
 },membership:async()=>({head:{vaultId:"fixture",revision:remote.revision,digest:remote.head},records:events.map(e=>p.encode(e).toString("base64")),next:remote.revision,more:false})};
 const options={request,authority:owner,authorityId:"owner",keyring:{generation:1,key:Buffer.alloc(32,9)},confirmedFingerprint:pair.requestFingerprint(request)};
 return {get store(){return store;},history,transport,options,events,device,pin,
  lose:()=>{lose=true;},reopen:()=>{store.close();store=new EncryptedStore({filename,key,scope});},
  coordinator:()=>new PairingCoordinator({store,history,transport,reauthenticate:async()=>true,now:()=>100001})};
}
test("unknown approval ACK survives encrypted reopen and exports only after exact membership readback",async t=>{
 const f=await fixture(t);f.lose();
 await assert.rejects(f.coordinator().approve(f.options),/LOST_ACK/);
 assert.equal(f.events.length,1);
 assert.equal(f.store.get("recovery","$pair-approval-"+f.options.request.body.requestId).phase,"PREPARED");
 f.reopen();const bytes=await f.coordinator().approve(f.options);
 assert.equal(f.events.length,1);
 const accepted=await pair.acceptTransfer({bytes,request:f.options.request,device:f.device,state:f.history.current,genesisFingerprint:f.pin,now:100001});
 assert.equal(accepted.keyring.generation,1);
 assert.equal(f.store.get("recovery","$pair-approval-"+f.options.request.body.requestId).phase,"CONFIRMED");
});
test("missing membership proof or cancelled reauthentication never exports a transfer",async t=>{
 const f=await fixture(t);
 f.transport.membership=async()=>({head:{vaultId:"fixture",revision:0,digest:f.history.current.head},records:[],next:0,more:false});
 await assert.rejects(f.coordinator().approve(f.options),/CONFIRMATION/);
 const refused=new PairingCoordinator({store:f.store,history:f.history,transport:f.transport,reauthenticate:async()=>false,now:()=>100001});
 await assert.rejects(refused.approve(f.options),/REAUTH/);
 assert.equal(f.store.get("recovery","$pair-approval-"+f.options.request.body.requestId).phase,"PREPARED");
});
