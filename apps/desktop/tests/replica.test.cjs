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

test("application adapter stores ordinary CRUD in encrypted outbox and projects existing UI lists",async t=>{
 const f=await fixture(t),{ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter"),app=new ApplicationAdapter(f.replica);
 app.mutate("category/createCategory",[{cid:"cat",title:"Work",color:"blue"}]);
 app.mutate("task/addTask",[{tid:"todo",title:"Private task",categories:["cat"]}]);
 app.mutate("task/createSubtask",[{sid:"sub",title:"Child"},"todo"]);
 app.mutate("task/updateTaskTitle",["todo","Changed"]);
 assert.equal(app.lists().tasks[0].title,"Changed");
 assert.deepEqual(app.lists().relations,[{tid:"todo",cid:"cat"}]);
 assert.equal(app.lists().subtasks[0].tid,"todo");
 const reopened=new ApplicationAdapter(f.reopen());assert.equal(reopened.lists().tasks[0].title,"Changed");
 const pending=reopened.replica.pending().length;
 assert.throws(()=>reopened.mutate("category/deleteCategory",["cat"]),/CATEGORY_IN_USE/);
 assert.equal(reopened.replica.pending().length,pending);
 reopened.mutate("task/deleteTask",["todo"]);
 assert.equal(reopened.lists().tasks.length,0);assert.equal(reopened.lists().subtasks.length,0);assert.equal(reopened.lists().relations.length,0);
 assert.throws(()=>reopened.mutate("task/addTask",[{tid:"todo",title:"Resurrect"}]),/RECREATE_REVIEW/);
});
test("application routing handles normal requests without legacy fallback and fails closed on lock",async t=>{
 const f=await fixture(t),{intercept}=require("../public/electron/e2ee/applicationRouting"),events=[];
 let locked=false;
 const entry={uid:"fixture",applicationActive:true,controller:{use:fn=>{if(locked)throw Error("VAULT_LOCKED");return fn(f.store);}}};
 const service={active:entry,busy:false,runtime:()=>({getAccount:()=>"fixture"}),group:{ipcService:{sender:(...args)=>events.push(args)}},syncEncrypted:async()=>{}};
 assert.equal(await intercept(service,"task/addTask","req",[{tid:"app",title:"Visible"}]),true);
 assert.ok(events.some(event=>event[0]==="sync-v2/state"&&event[3].tasks[0].title==="Visible"));
 locked=true;events.length=0;
 assert.equal(await intercept(service,"task/getAllTaskList","locked",[]),true);
 assert.equal(events[0][2],false);assert.equal(events[0][3].code,"VAULT_LOCKED");
 assert.equal(await intercept(service,"task/unknownFutureWrite","unsupported",[]),true);
 assert.equal(events.at(-1)[3].code,"UNSUPPORTED_APPLICATION_ACTION");
 entry.applicationActive=false;assert.equal(await intercept(service,"task/addTask","old",[]),false);
});

test("recurring completion clones the completed occurrence and resets the next task atomically",async t=>{
 const f=await fixture(t),{ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
 const start=Date.parse("2025-01-31T00:00:00Z"),now=Date.parse("2025-02-01T00:00:00Z"),due=Date.parse("2025-03-03T00:00:00Z");
 const app=new ApplicationAdapter(f.replica,{now:()=>now});
 app.mutate("category/createCategory",[{cid:"cat",title:"Work"}]);
 app.mutate("task/addTask",[{tid:"repeat",title:"Recurring",due_date:start,repeat_period:"month",categories:["cat"]}]);
 app.mutate("task/createSubtask",[{sid:"child",title:"Child",done:true,due_date:start},"repeat"]);
 const before=f.replica.pending().length;
 app.mutate("task/updateTaskDone",["repeat",true]);
 assert.equal(f.replica.pending().length,before+1);
 const lists=app.lists(),original=lists.tasks.find(row=>row.tid==="repeat"),clone=lists.tasks.find(row=>row.tid!=="repeat");
 assert.equal(original.done,false);assert.equal(original.due_date,due);assert.equal(original.recurrence_generation,"1");
 assert.equal(clone.done,true);assert.equal(clone.repeat_period,"");assert.equal(clone.done_at,now);
 assert.equal(lists.relations.length,2);assert.equal(lists.subtasks.length,2);
 assert.equal(lists.subtasks.find(row=>row.tid==="repeat").due_date,due);
 assert.equal(lists.subtasks.find(row=>row.tid==="repeat").done,false);
 assert.equal(lists.subtasks.find(row=>row.tid===clone.tid).done,true);
 assert.equal(new ApplicationAdapter(f.reopen()).lists().tasks.length,2);
});
test("invalid recurring schedule leaves the encrypted application unchanged",async t=>{
 const f=await fixture(t),{ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter"),app=new ApplicationAdapter(f.replica);
 assert.throws(()=>app.mutate("task/addTask",[{tid:"bad",repeat_period:"day",due_date:0}]),/RANGE/);
 assert.equal(app.lists().tasks.length,0);assert.equal(f.replica.pending().length,0);
 assert.equal(f.store.entries("recovery").length,0);
});

async function resolutionFixture(t){
 const f=await fixture(t);
 const base={objectId:"task",version:"1",deleted:false,fields:[{slot:1,value:"before"}]};
 f.store.put("confirmed","task",base);
 const id=f.replica.enqueue([{objectId:"task",baseVersion:"1",deleted:false,fields:[{slot:1,value:"mine"}]}]);
 f.store.put("confirmed","task",{...base,version:"2",fields:[{slot:1,value:"remote"}]});
 f.replica.preserveConflict(id);
 const {outboxDetail}=require("../public/electron/e2ee/outboxReview"),{resolveUnsignedConflict}=require("../public/electron/e2ee/resolveConflict");
 const request={id,objectId:"task",expectedRevision:outboxDetail(f.store,{id,objectId:"task"}).revision,choice:"local"};
 return {...f,id,request,resolve:request=>resolveUnsignedConflict(f.replica,request)};
}
test("unsigned conflict selection archives originals and queues only once against current version",async t=>{
 const f=await resolutionFixture(t),original=f.store.get("outbox",f.id),result=f.resolve(f.request);
 assert.equal(result.phase,"QUEUED");assert.notEqual(result.newId,f.id);
 const pending=f.store.get("outbox",result.newId);
 assert.equal(pending.changes[0].baseVersion,"2");assert.equal(pending.changes[0].fields[0].value,"mine");
 assert.equal(pending.record,undefined);
 assert.deepEqual(f.store.get("recovery","$resolved-conflict-"+f.id).original,original);
 assert.deepEqual(f.resolve(f.request),result);assert.equal(f.replica.pending().length,1);
 assert.throws(()=>f.resolve({...f.request,choice:"current"}),/RESOLUTION_CHANGED/);
 const reopened=f.reopen();assert.deepEqual(reopened.store.get("recovery","$resolved-conflict-"+f.id).result,result);
});
test("choosing confirmed copy keeps the abandoned local edit in encrypted recovery",async t=>{
 const f=await resolutionFixture(t),result=f.resolve({...f.request,choice:"current"});
 assert.deepEqual(result,{phase:"CURRENT_SELECTED",newId:null});assert.equal(f.replica.pending().length,0);
 assert.equal(f.store.get("visible","task").fields[0].value,"remote");
 assert.equal(f.store.get("recovery","$resolved-conflict-"+f.id).original.changes[0].fields[0].value,"mine");
});
test("changed comparison, signed requests and dependent edits refuse resolution without writes",async t=>{
 const f=await resolutionFixture(t),original=f.store.get("outbox",f.id);
 assert.throws(()=>f.resolve({...f.request,expectedRevision:"0".repeat(64)}),/REVIEW_CHANGED/);
 f.store.put("outbox",f.id,{...original,record:Buffer.from("synthetic-signed-record")});
 assert.throws(()=>f.resolve(f.request),/ACK_RECONCILIATION_REQUIRED/);
 f.store.put("outbox",f.id,original);
 f.store.put("outbox","f".repeat(32),{status:"draft",counter:"2",changes:[{...original.changes[0],baseVersion:"2"}],bases:[]});
 assert.throws(()=>f.resolve(f.request),/DEPENDENT_REVIEW_REQUIRED/);
 assert.deepEqual(f.store.get("outbox",f.id),original);
 assert.equal(f.store.get("recovery","$resolved-conflict-"+f.id),null);
});
test("failure saving the resolution rolls back outbox, overlay and reserved counter together",async t=>{
 const f=await resolutionFixture(t),before=f.store.entries("outbox"),visible=f.store.get("visible","task"),meta=f.store.get("confirmed","$sync-state"),put=f.store.put;
 f.store.put=function(bucket,id,value){if(id.startsWith("$resolved-conflict-"))throw Error("SYNTHETIC_DISK_FAILURE");return put.call(this,bucket,id,value);};
 assert.throws(()=>f.resolve(f.request),/SYNTHETIC_DISK_FAILURE/);f.store.put=put;
 assert.deepEqual(f.store.entries("outbox"),before);assert.deepEqual(f.store.get("visible","task"),visible);
 assert.deepEqual(f.store.get("confirmed","$sync-state"),meta);
});

test("outbox detail compares bounded fields without mutating drafts or returning signatures",async t=>{
 const f=await fixture(t),{outboxDetail}=require("../public/electron/e2ee/outboxReview");
 const id=f.replica.enqueue([{...changes[0],fields:Array.from({length:21},(_,slot)=>({slot,value:"x".repeat(2100)}))}]);
 await f.replica.prepare(id,f.context);const before=f.store.get("outbox",id);
 const page=outboxDetail(f.store,{id,objectId:"task"});
 assert.equal(page.fields.length,20);assert.equal(page.more,true);assert.equal(page.baseMissing,true);
 assert.equal(page.fields[0].local.text.length,2000);assert.equal(page.fields[0].local.truncated,true);
 assert.equal(page.fields[0].current.present,false);assert.equal(JSON.stringify(page).includes('"record"'),false);
 const tail=outboxDetail(f.store,{id,objectId:"task",offset:page.next,expectedRevision:page.revision});assert.equal(tail.fields.length,1);assert.equal(tail.more,false);
 assert.deepEqual(f.store.get("outbox",id),before);
 assert.throws(()=>outboxDetail(f.store,{id,objectId:"unrelated"}),/REVIEW_NOT_FOUND/);
 assert.throws(()=>outboxDetail(f.store,{id:"$owner-identity",objectId:"task"}),/INVALID_REVIEW_DETAIL/);
});

test("outbox review is bounded, read-only and excludes raw private payloads",async t=>{
 const f=await fixture(t),{outboxReviews}=require("../public/electron/e2ee/outboxReview");
 const first=f.replica.enqueue(changes);await f.replica.prepare(first,f.context);f.replica.preserveConflict(first,"STALE_SIGNED_REQUEST");
 f.replica.enqueue([{...changes[0],objectId:"other"}]);
 const before=f.store.entries("outbox"),page=outboxReviews(f.store,{limit:1});
 assert.equal(page.items.length,1);assert.equal(page.more,true);
 const next=outboxReviews(f.store,{after:page.next,limit:1});
 assert.equal(next.items.length,1);assert.equal(next.more,false);assert.notEqual(page.items[0].id,next.items[0].id);
 const result=JSON.stringify(outboxReviews(f.store));
 assert.equal(result.includes("SYNTHETIC_PENDING_PRIVATE"),false);assert.equal(result.includes('"record"'),false);
 assert.deepEqual(f.store.entries("outbox"),before);
 for(const request of [{limit:0},{limit:51},{after:"$owner-identity"}])assert.throws(()=>outboxReviews(f.store,request),/INVALID_REVIEW_PAGE/);
});

test("review classifies full three-way values and rejects mixed-page versions",async t=>{
 const f=await fixture(t),{outboxDetail}=require("../public/electron/e2ee/outboxReview");
 const fields=values=>values.map((value,slot)=>({slot,value}));
 const base={objectId:"task",version:"1",deleted:false,fields:fields(["same","base","base","base","base","base","x".repeat(2100)+"base"])};
 f.store.put("confirmed","task",base);
 const id=f.replica.enqueue([{objectId:"task",baseVersion:"1",deleted:false,fields:fields(["same","local","base","equal","local",null,"x".repeat(2100)+"local"])}]);
 const current={...base,version:"2",fields:fields(["same","base","remote","equal","remote","base","x".repeat(2100)+"remote"])};
 f.store.put("confirmed","task",current);
 const page=outboxDetail(f.store,{id,objectId:"task"});
 assert.deepEqual(page.fields.map(field=>field.status),["UNCHANGED","LOCAL_ONLY","REMOTE_ONLY","MATCHING_VALUES","FIELD_CONFLICT","LOCAL_ONLY","FIELD_CONFLICT"]);
 assert.equal(page.fields[6].local.text,page.fields[6].current.text);
 assert.equal(page.fields[6].local.truncated,true);
 assert.throws(()=>outboxDetail(f.store,{id,objectId:"task",offset:1}),/REVISION_REQUIRED/);
 f.store.put("confirmed","task",{...current,version:"3"});
 assert.throws(()=>outboxDetail(f.store,{id,objectId:"task",offset:1,expectedRevision:page.revision}),/REVIEW_CHANGED/);
 const refreshed=outboxDetail(f.store,{id,objectId:"task"});assert.notEqual(refreshed.revision,page.revision);
 f.store.put("confirmed","task",{...current,deleted:true});
 assert.ok(outboxDetail(f.store,{id,objectId:"task"}).fields.every(field=>field.status==="REVIEW_REQUIRED"));
});
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

async function advanceMembership(f){
 const other=await p.createDevice(),body={vaultId:"vault",revision:1,previous:f.engine.history.current.head,signer:"owner",operation:"add",
  device:{id:"other",role:"read",canAuthorizeDevices:false,signingKey:other.signing.publicKey,encryptionKey:other.encryption.publicKey}};
 const record={body,signature:await p.sign(f.context.device.signing.privateKey,"membership",body)};
 await f.engine.history.append(record);
 f.transport.membership=async()=>({head:{vaultId:"vault",revision:1,digest:f.engine.history.current.head},genesis:p.encode(f.genesis).toString("base64"),records:[],next:1,more:false});
}
test("stale rejected signed bytes are preserved while independent edits continue",async t=>{
 const f=await engineFixture(t),id=f.replica.enqueue(changes),record=await f.replica.prepare(id,f.context),original=f.store.get("outbox",id);
 f.replica.enqueue([{...changes[0],baseVersion:"1"}]);
 f.replica.enqueue([{...changes[0],objectId:"independent"}]);
 await advanceMembership(f);const push=f.transport.push;let retries=0;
 f.transport.push=async value=>{if(value.body.mutationId===id){retries++;assert.deepEqual(value,record);throw Error("SYNC_CHECKPOINT_CONFLICT");}return push(value);};
 assert.deepEqual(await f.engine.run(),{cursor:"1",pending:2,conflicts:1});
 assert.deepEqual(f.store.get("recovery",id),original);
 assert.equal(f.store.get("outbox",id).reviewReason,"STALE_SIGNED_REQUEST");
 assert.equal(f.store.get("visible","task").pending,true);
 await f.engine.run();assert.equal(retries,1);
 f.replica.preserveConflict(id);assert.deepEqual(f.store.get("recovery",id),original);
 const reopened=f.reopen();assert.equal(reopened.pending()[0].value.reviewReason,"STALE_SIGNED_REQUEST");
});
test("checkpoint failure without verified newer membership does not reclassify pending",async t=>{
 const f=await engineFixture(t),id=f.replica.enqueue(changes);await f.replica.prepare(id,f.context);
 const original=f.store.get("outbox",id);f.transport.push=async()=>{throw Error("SYNC_CHECKPOINT_CONFLICT");};
 await assert.rejects(f.engine.run(),/SYNC_CHECKPOINT_CONFLICT/);
 assert.deepEqual(f.store.get("outbox",id),original);assert.equal(f.store.get("recovery",id),null);
});
test("unknown network outcome under newer membership retains retryable signed bytes",async t=>{
 const f=await engineFixture(t),id=f.replica.enqueue(changes);await f.replica.prepare(id,f.context);
 const original=f.store.get("outbox",id);await advanceMembership(f);
 f.transport.push=async()=>{throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(f.engine.run(),/SYNC_UNAVAILABLE/);
 assert.deepEqual(f.store.get("outbox",id),original);assert.equal(f.store.get("recovery",id),null);
});
test("old accepted request behind snapshot still settles after membership changes",async t=>{
 const f=await engineFixture(t),id=f.replica.enqueue(changes),record=await f.replica.prepare(id,f.context);
 await f.transport.push(record);await f.replica.installSnapshot(await snapshotInput(f,[record],"1"));
 await advanceMembership(f);
 assert.deepEqual(await f.engine.run(),{cursor:"1",pending:0,conflicts:0});
 assert.equal(f.accepted.length,1);assert.equal(f.store.get("recovery",id),null);
});

test("explicit reconciliation verifies an accepted archived request without duplicate application",async t=>{
 const f=await engineFixture(t),id=f.replica.enqueue(changes),record=await f.replica.prepare(id,f.context);
 await f.transport.push(record);await f.replica.installSnapshot(await snapshotInput(f,[record],"1"));f.replica.preserveConflict(id,"STALE_SIGNED_REQUEST");
 await advanceMembership(f);
 assert.deepEqual(await f.engine.reconcile(id),{phase:"APPLIED"});
 assert.equal(f.accepted.length,1);assert.equal(f.replica.pending().length,0);
 assert.deepEqual(f.store.get("recovery",id).record,p.encode(record));
});
test("explicit reconciliation preserves originals on rejection, timeout and forged receipt",async t=>{
 const f=await engineFixture(t),id=f.replica.enqueue(changes);await f.replica.prepare(id,f.context);f.replica.preserveConflict(id);
 const original=f.store.get("outbox",id);
 f.transport.push=async()=>{throw Error("SYNC_CHECKPOINT_CONFLICT");};
 assert.deepEqual(await f.engine.reconcile(id),{phase:"REVIEW_REQUIRED"});assert.deepEqual(f.store.get("outbox",id),original);
 f.transport.push=async()=>{throw Error("SYNC_UNAVAILABLE");};
 await assert.rejects(f.engine.reconcile(id),/SYNC_UNAVAILABLE/);assert.deepEqual(f.store.get("outbox",id),original);
 f.transport.push=async()=>({seq:"1",versions:{task:"99"}});
 await assert.rejects(f.engine.reconcile(id));assert.deepEqual(f.store.get("outbox",id),original);
});
test("reconciliation serializes operations and a close blocks late ACK",async t=>{
 const f=await engineFixture(t),id=f.replica.enqueue(changes);await f.replica.prepare(id,f.context);
 const original=f.store.get("outbox",id),push=f.transport.push;let ready,finish;
 const reached=new Promise(resolve=>{ready=resolve;});
 f.transport.push=async record=>{ready();await new Promise(resolve=>{finish=resolve;});return push(record);};
 const running=f.engine.reconcile(id);await reached;
 await assert.rejects(f.engine.reconcile(id),/SYNC_BUSY/);
 f.engine.close();finish();await assert.rejects(running,/SYNC_CANCELLED/);
 assert.deepEqual(f.store.get("outbox",id),original);
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
