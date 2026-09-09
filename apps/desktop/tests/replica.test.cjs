const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const p=require("../public/electron/e2ee/protocol"),m=require("../public/electron/e2ee/membership");
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-replica-fixture-"));const filename=path.join(dir,"vault.db"),key=Buffer.alloc(32,2);
 const scope={environment:"development",accountId:"fixture",vaultId:"vault"};let store=new EncryptedStore({filename,key,scope,create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const device=await p.createDevice(),body={schema:1,vaultId:"vault",recoveryKey:Buffer.alloc(32,1),owner:{id:"owner",role:"write",canAuthorizeDevices:true,signingKey:device.signing.publicKey,encryptionKey:device.encryption.publicKey}};
 const genesis={body,signature:await p.sign(device.signing.privateKey,"genesis",body)};
 const state=await m.verifyGenesis(genesis,p.fingerprint(body));
 const context={device,state,deviceId:"owner",epoch:"1",key:Buffer.alloc(32,3)};
 const replicaScope={vaultId:"vault",epoch:"1",deviceId:"owner"};
 return {get store(){return store;},replica:new EncryptedReplica(store,replicaScope),context,genesis,
  reopen(){store.close();store=new EncryptedStore({filename,key,scope});return new EncryptedReplica(store,replicaScope);},dir};
}
const changes=[{objectId:"task",baseVersion:"0",deleted:false,fields:[{slot:1,value:{title:"SYNTHETIC_PENDING_PRIVATE"}}]}];
test("normal drafts never reuse a migration counter, including reserved unsent counters",async t=>{
 const f=await fixture(t);
 f.store.put("recovery","$migration-counter-owner","42");
 const id=f.replica.enqueue(changes);
 assert.equal((await f.replica.prepare(id,f.context)).body.counter,"43");
 const reopened=f.reopen();
 f.store.put("recovery","$migration-counter-owner","48");
 const next=reopened.enqueue([{...changes[0],objectId:"second"}]);
 assert.equal((await reopened.prepare(next,f.context)).body.counter,"49");
});
test("local migration readiness requires active journal and verified snapshot; failure preserves data",async t=>{
 const f=await fixture(t),{MigrationJournal}=require("../public/electron/e2ee/migrationJournal");
 const journal=new MigrationJournal(f.store,f.store.scope());
 journal.begin("cutover");
 const input=await snapshotInput(f,[],"0");
 await assert.rejects(f.replica.installSnapshot({...input,migrationJournal:journal}),/UNCONFIRMED/);
 journal.advance("PREPARING","FROZEN",{freezeSeq:"1",sourceEpoch:"old",targetEpoch:"1"});
 journal.advance("FROZEN","UPLOADING",{});
 journal.advance("UPLOADING","VERIFIED",{ciphertextManifest:input.snapshot.digest,readbackMatches:true,allPagesVerified:true});
 journal.advance("VERIFIED","COMMITTING",{});
 await journal.confirmCommitted(async()=>({id:"cutover",phase:"ACTIVE",vaultId:"vault",freezeSeq:"1",targetEpoch:"1",ciphertextManifest:input.snapshot.digest}));
 await assert.rejects(f.replica.installSnapshot({...input,migrationJournal:journal}),/READBACK/);
 f.store.put("recovery","$migration-readback-cutover",{snapshot:input.snapshot});
 f.store.put("recovery","$migration-counter-owner","17");
 const id=f.replica.enqueue(changes);
 await assert.rejects(f.replica.installSnapshot({...input,snapshot:{...input.snapshot,digest:"a".repeat(64)},migrationJournal:journal}),/DIGEST/);
 assert.equal(f.store.get("recovery","$migration-local-cutover"),null);
 assert.equal(f.replica.pending()[0].id,id);
 await f.replica.installSnapshot({...input,migrationJournal:journal});
 assert.equal(f.store.get("recovery","$migration-local-cutover").phase,"READY");
 assert.equal(f.replica.pending()[0].id,id);
 assert.equal(f.store.get("confirmed","$sync-state").counter,"18");
 assert.ok(f.store.get("recovery","$migration-readback-cutover"));
 f.reopen();assert.equal(f.store.get("recovery","$migration-local-cutover").phase,"READY");
});
test("draft and exact signed retry survive encrypted DB restart before ACK",async t=>{
 const f=await fixture(t);const id=f.replica.enqueue(changes);assert.equal(f.store.get("confirmed","task"),null);
 const record=await f.replica.prepare(id,f.context);const reopened=f.reopen();assert.deepEqual(await reopened.prepare(id,f.context),record);
 await assert.rejects(reopened.prepare(id,{...f.context,epoch:"other"}),/REPLICA_SCOPE_MISMATCH/);
 assert.equal(f.store.get("visible","task").pending,true);
 await assert.rejects(reopened.applyChange({record,result:{seq:"1",versions:{task:"9"}}},f.context));
 assert.equal(reopened.pending().length,1);
 await reopened.applyChange({record,result:{seq:"1",versions:{task:"1"}}},f.context);
 assert.equal(reopened.pending().length,0);assert.equal(f.store.get("visible","task").pending,false);
 assert.equal(f.store.get("confirmed","task").fields[0].value.title,"SYNTHETIC_PENDING_PRIVATE");
 await assert.rejects(reopened.applyChange({record,result:{seq:"1",versions:{task:"1"}}},f.context),/CURSOR/);
 for(const name of fs.readdirSync(f.dir))assert.equal(fs.readFileSync(path.join(f.dir,name)).includes(Buffer.from("SYNTHETIC_PENDING_PRIVATE")),false);
});
test("conflicted draft remains recoverable and overlapping queued edits are not discarded",async t=>{
 const f=await fixture(t);const id=f.replica.enqueue(changes);assert.throws(()=>f.replica.enqueue(changes),/LOCAL_BASE_CONFLICT/);
 await f.replica.prepare(id,f.context);f.replica.preserveConflict(id);
 assert.deepEqual(f.store.get("recovery",id).changes,changes);assert.equal(f.replica.pending()[0].value.status,"conflict");
 await assert.rejects(f.replica.prepare(id,f.context),/DRAFT_UNAVAILABLE/);
});

test("successive offline edits queue in counter order and preserve the newest overlay",async t=>{
 const f=await fixture(t),first=f.replica.enqueue(changes);
 const secondChanges=[{...changes[0],baseVersion:"1",fields:[{slot:1,value:{title:"second"}}]}];
 const second=f.replica.enqueue(secondChanges);
 assert.deepEqual(f.replica.pending().map(row=>row.id),[first,second]);
 await assert.rejects(f.replica.prepare(second,f.context),/WAITING_FOR_PREVIOUS_EDIT/);
 assert.equal(f.store.get("visible","task").version,"2");
 const record=await f.replica.prepare(first,f.context);
 const reopened=f.reopen();
 await reopened.applyChange({record,result:{seq:"1",versions:{task:"1"}}},f.context);
 assert.equal(f.store.get("visible","task").fields[0].value.title,"second");
 const next=await reopened.prepare(second,f.context);
 await reopened.applyChange({record:next,result:{seq:"2",versions:{task:"2"}}},f.context);
 assert.deepEqual(reopened.status(),{cursor:"2",pending:0,conflicts:0});
 assert.equal(f.store.get("visible","task").pending,false);
});

async function snapshotInput(f,records,seq){
 const {createHash}=require("node:crypto"),hash=createHash("sha256");
 const objects=records.map((record,i)=>{
  const op=record.body.operations[0],raw=p.encode(record),version=(BigInt(op.baseVersion)+1n).toString(),rowSeq=String(i+1);
  hash.update(p.encode([op.objectId,version,rowSeq,op.deleted,0,createHash("sha256").update(raw).digest()]));
  return {objectId:op.objectId,version,seq:rowSeq,deleted:op.deleted,operationIndex:0,record:raw.toString("base64")};
 });
 return {snapshot:{id:"00000000-0000-0000-0000-000000000001",epoch:"1",seq,membershipHead:f.context.state.head,count:objects.length,digest:hash.digest("hex")},
  history:{current:f.context.state,at:()=>f.context.state},keyForGeneration:async()=>f.context.key,
  pages:[{objects,next:objects.at(-1)?.objectId||"",more:false}]};
}

test("snapshot digest failure leaves live data, cursor and drafts unchanged; success preserves unknown ACK",async t=>{
 const f=await fixture(t),id=f.replica.enqueue(changes),record=await f.replica.prepare(id,f.context);
 const input=await snapshotInput(f,[record],"1");
 const before=f.store.get("visible","task");
 await assert.rejects(f.replica.installSnapshot({...input,snapshot:{...input.snapshot,digest:"0".repeat(64)}}),/DIGEST/);
 assert.deepEqual(f.store.get("visible","task"),before);
 assert.equal(f.replica.status().cursor,"0");
 assert.equal(f.store.entries("recovery").length,0);
 await f.replica.installSnapshot(input);
 assert.equal(f.replica.status().cursor,"1");
 assert.equal(f.replica.pending().length,1);
 assert.deepEqual(await f.replica.prepare(id,f.context),record);
 assert.equal(f.store.get("confirmed","task").version,"1");
 assert.equal(f.store.get("visible","task").pending,true);
 const empty=await snapshotInput(f,[],"2");
 await assert.rejects(f.replica.installSnapshot(empty),/OBJECT_ROLLBACK/);
 assert.equal(f.replica.status().cursor,"1");
});

async function engineFixture(t){
 const f=await fixture(t),accepted=[];
 const {MembershipHistory}=require("../public/electron/e2ee/readProtocol");
 const {EncryptedSynchronizer}=require("../public/electron/e2ee/synchronize");
 const history=await new MembershipHistory(f.genesis,p.fingerprint(f.genesis.body)).initialize();
 const transport={
  membership:async()=>({head:{vaultId:"vault",revision:0,digest:history.current.head},genesis:p.encode(f.genesis).toString("base64"),records:[],next:0,more:false}),
  pull:async proof=>{
   await p.verify(f.context.device.signing.publicKey,"request",proof.body,proof.signature);
   const {after,until}=proof.body.parameters,target=until==="0"?String(accepted.length):until;
   return {until:target,next:target,more:false,changes:accepted.slice(Number(after),Number(target))};
  },
  push:async record=>{
   const previous=accepted.find(c=>p.decode(Buffer.from(c.record,"base64")).body.mutationId===record.body.mutationId);
   if(previous)return previous.result;
   const result={seq:String(accepted.length+1),versions:Object.fromEntries(record.body.operations.map(op=>[op.objectId,String(BigInt(op.baseVersion)+1n)]))};
   accepted.push({record:p.encode(record).toString("base64"),result});return result;
  }
 };
 const engine=new EncryptedSynchronizer({replica:f.replica,history,device:f.context.device,deviceId:"owner",epoch:"1",keyForGeneration:async()=>f.context.key,transport});
 t.after(()=>engine.close());return {...f,transport,engine,accepted};
}

test("sync loop signs reads, sends queued edits in order and converges",async t=>{
 const f=await engineFixture(t);
 f.replica.enqueue(changes);
 f.replica.enqueue([{...changes[0],baseVersion:"1",fields:[{slot:1,value:"later"}]}]);
 const first=f.engine.run();assert.equal(f.engine.run(),first);
 assert.deepEqual(await first,{cursor:"2",pending:0,conflicts:0});
 assert.equal(f.accepted.length,2);
 assert.equal(f.store.get("visible","task").fields[0].value,"later");
});

test("lost ACK retains exact bytes and reconnect pull settles the accepted edit",async t=>{
 const f=await engineFixture(t),id=f.replica.enqueue(changes),push=f.transport.push;
 f.transport.push=async record=>{await push(record);throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(f.engine.run(),/SYNC_UNAVAILABLE/);
 assert.equal(f.replica.pending().length,1);
 const bytes=f.store.get("outbox",id).record;
 assert.equal(f.accepted[0].record,bytes.toString("base64"));
 f.transport.push=push;
 assert.deepEqual(await f.engine.run(),{cursor:"1",pending:0,conflicts:0});
 assert.equal(f.accepted.length,1);
});

test("unknown ACK behind a snapshot is settled only using the original signed change",async t=>{
 const f=await engineFixture(t),id=f.replica.enqueue(changes),record=await f.replica.prepare(id,f.context);
 await f.transport.push(record);
 await f.replica.installSnapshot(await snapshotInput(f,[record],"1"));
 assert.equal(f.replica.pending().length,1);
 assert.deepEqual(await f.engine.run(),{cursor:"1",pending:0,conflicts:0});
 assert.equal(f.store.get("visible","task").pending,false);
});

test("close during a network response blocks late plaintext application",async t=>{
 const f=await engineFixture(t),id=f.replica.enqueue(changes),record=await f.replica.prepare(id,f.context);
 await f.transport.push(record);
 const pull=f.transport.pull;
 f.transport.pull=async proof=>{const page=await pull(proof);f.engine.close();return page;};
 await assert.rejects(f.engine.run(),/SYNC_CANCELLED/);
 assert.equal(f.replica.status().cursor,"0");
 assert.equal(f.replica.pending().length,1);
});

test("snapshot cannot overwrite an edit queued while pages are being verified",async t=>{
 const f=await fixture(t);
 const input=await snapshotInput(f,[],"0");
 input.pages=(async function*(){f.replica.enqueue(changes);yield {objects:[],next:"",more:false};})();
 await assert.rejects(f.replica.installSnapshot(input),/REPLICA_CHANGED/);
 assert.equal(f.replica.pending().length,1);
 assert.equal(f.store.get("visible","task").pending,true);
});
test("locking during preparation cannot persist a late signed draft",async t=>{
 const f=await fixture(t);const id=f.replica.enqueue(changes);const pending=f.replica.prepare(id,f.context);f.store.close();
 await assert.rejects(pending,/LOCKED/);const reopened=f.reopen();assert.equal(reopened.pending()[0].value.status,"draft");
});
