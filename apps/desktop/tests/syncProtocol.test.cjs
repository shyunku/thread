const {test}=require("node:test"),assert=require("node:assert/strict");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership"),sync=require("../public/electron/e2ee/syncProtocol");
async function fixture(){const device=await p.createDevice();const body={schema:1,vaultId:"sync-fixture",recoveryKey:Buffer.alloc(32,7),owner:{id:"owner",role:"write",canAuthorizeDevices:true,signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey}};
 const state=await m.verifyGenesis({body,signature:await p.sign(device.signing.privateKey,"genesis",body)},p.fingerprint(body));return {state,device,epoch:"1",deviceId:"owner",key:Buffer.alloc(32,9),counter:"1",mutationId:"change",changes:[{objectId:"one",baseVersion:"0",deleted:false,fields:[{slot:1,value:{title:"SYNTHETIC_SECRET"}}]}]};}
test("full object encrypted batch binds all fields and verifies receipt versions",async()=>{
 const f=await fixture();const record=await sync.createBatch(f);assert.equal(p.encode(record).includes(Buffer.from("SYNTHETIC_SECRET")),false);
 const objects=await sync.decryptBatch(record,f);assert.equal(objects[0].fields[0].value.title,"SYNTHETIC_SECRET");assert.equal(objects[0].version,"1");
 sync.verifyReceipt(record,{seq:"9007199254740993",versions:{one:"1"}});
 assert.throws(()=>sync.verifyReceipt(record,{seq:"1",versions:{one:"2"}}));
 assert.throws(()=>sync.verifyReceipt(record,{seq:"1",versions:{one:"1",extra:"1"}}));
 await assert.rejects(sync.decryptBatch(record,{...f,epoch:"other"}));await assert.rejects(sync.decryptBatch(record,{...f,lastCounter:"1"}));
 record.body.operations[0].fields[0].ciphertext[0]^=1;await assert.rejects(sync.decryptBatch(record,f));
});
test("duplicate objects, invalid counters and deleted payloads are rejected",async()=>{
 const f=await fixture();await assert.rejects(sync.createBatch({...f,changes:[...f.changes,...f.changes]}));
 await assert.rejects(sync.createBatch({...f,counter:"01"}));
 await assert.rejects(sync.createBatch({...f,changes:[{...f.changes[0],deleted:true}]}));
 const r=await sync.createBatch({...f,changes:[{objectId:"one",baseVersion:"1",deleted:true,fields:[]}]});assert.equal((await sync.decryptBatch(r,f))[0].deleted,true);
});
