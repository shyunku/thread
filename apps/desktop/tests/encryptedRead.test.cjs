const test=require("node:test"),assert=require("node:assert/strict"),{createHash}=require("node:crypto");
const p=require("../public/electron/e2ee/protocol"),sync=require("../public/electron/e2ee/syncProtocol");
const {MembershipHistory,createReadRequest,SnapshotVerifier}=require("../public/electron/e2ee/readProtocol");
const {createTransport}=require("../public/electron/e2ee/transport");
async function fixture(){
 const device=await p.createDevice(),body={schema:1,vaultId:"fixture",recoveryKey:Buffer.alloc(32,9),owner:{id:"owner",signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey,role:"write",canAuthorizeDevices:true}};
 const genesis={body,signature:await p.sign(device.signing.privateKey,"genesis",body)};
 const history=await new MembershipHistory(genesis,p.fingerprint(body)).initialize(),key=Buffer.alloc(32,8);
 const context={state:history.current,epoch:"1",deviceId:"owner",device,key};
 const record=await sync.createBatch({...context,counter:"1",mutationId:"mutation",changes:[{objectId:"one",baseVersion:"0",deleted:false,fields:[{slot:1,value:{title:"synthetic"}}]}]});
 const raw=p.encode(record),object={objectId:"one",version:"1",seq:"1",deleted:false,operationIndex:0,record:raw.toString("base64")};
 const digest=createHash("sha256").update(p.encode(["one","1","1",false,0,createHash("sha256").update(raw).digest()])).digest("hex");
 return {context,history,record,object,snapshot:{id:"00000000-0000-0000-0000-000000000001",epoch:"1",seq:"1",membershipHead:history.current.head,digest,count:1}};
}
test("read proof binds operation, parameters, device and expiry",async()=>{
 const f=await fixture(),r=await createReadRequest({...f.context,operation:"pull",parameters:{after:"0",until:"0"},now:1000});
 assert.equal(r.body.expiresAt,61000);await p.verify(f.context.device.signing.publicKey,"request",r.body,r.signature);
 await assert.rejects(p.verify(f.context.device.signing.publicKey,"request",{...r.body,operation:"snapshot"},r.signature));
});
test("snapshot verifies original signatures, checkpoint, provenance and whole manifest before commit",async()=>{
 const f=await fixture(),staged=[];
 const options={snapshot:f.snapshot,history:f.history,epoch:"1",minimumSeq:"0",keyForGeneration:async()=>f.context.key,stage:async v=>staged.push(v)};
 const v=new SnapshotVerifier(options);await v.addPage({objects:[f.object],next:"one",more:false});
 assert.deepEqual(v.finish(),{cursor:"1",deviceCounters:[{deviceId:"owner",counter:"1"}]});assert.equal(staged[0].fields[0].value.title,"synthetic");
 for(const changed of [{version:"2"},{seq:"2"},{objectId:"different"},{deleted:true},{operationIndex:1}]){
  const invalid=new SnapshotVerifier(options);await assert.rejects(invalid.addPage({objects:[{...f.object,...changed}],next:"one",more:false}));
 }
 const wrong=new SnapshotVerifier({...options,snapshot:{...f.snapshot,digest:"0".repeat(64)}});
 await wrong.addPage({objects:[f.object],next:"one",more:false});assert.throws(()=>wrong.finish(),/DIGEST/);
 const missing=new SnapshotVerifier(options);await missing.addPage({objects:[],next:"",more:false});assert.throws(()=>missing.finish(),/INCOMPLETE/);
 assert.throws(()=>new SnapshotVerifier({...options,minimumSeq:"2"}),/ROLLBACK/);
});
test("transport bounds replies, rejects insecure remote endpoints, and hides raw failures",async()=>{
 assert.throws(()=>createTransport({endpoint:"http://remote.invalid",token:async()=>""}),/INSECURE/);
 const secret="PRIVATE_SYNTHETIC_TOKEN";let options;
 const transport=createTransport({endpoint:"http://127.0.0.1:4033",token:async()=>secret,fetch:async(_,o)=>{options=o;return new Response(JSON.stringify({code:"PRIVATE_SQL_SECRET"}),{status:500});}});
 await assert.rejects(transport.membership(),e=>e.message==="SYNC_UNAVAILABLE");
 assert.equal(options.redirect,"error");assert.equal(options.headers.Authorization,"Bearer "+secret);
});
test("only the explicit vault-not-found 404 permits initial registration",async()=>{
 for(const status of [404,500]){
  const transport=createTransport({endpoint:"http://localhost:4033",token:async()=>"synthetic",
   fetch:async()=>new Response(JSON.stringify({code:"VAULT_NOT_FOUND"}),{status})});
  await assert.rejects(transport.membership(),error=>error.message===(status===404?"VAULT_NOT_FOUND":"SYNC_UNAVAILABLE"));
 }
});
