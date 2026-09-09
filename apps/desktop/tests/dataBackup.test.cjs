const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {EncryptedStore}=require("../public/electron/e2ee/localStore");
const backup=require("../public/electron/e2ee/dataBackup");
const scope={vaultId:"fixture",genesisFingerprint:"a".repeat(64)};
const storeScope={environment:"development",accountId:"fixture-user",vaultId:"fixture"};
const privateText="SYNTHETIC_BACKUP_PRIVATE_TITLE_한글";
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"thread-data-backup-"));
 const key=Buffer.alloc(32,7),source=path.join(directory,"source.db");
 const store=new EncryptedStore({filename:source,key,scope:storeScope,create:true});
 t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
 store.put("confirmed","task",{version:"1",title:privateText});
 store.put("confirmed","$sync-state",{scope:{deviceId:"old-device"},cursor:"12",counter:"15"});
 store.put("visible","task",{title:privateText,pending:true});
 store.put("outbox","pending",{record:Buffer.from([1,2,3]),changes:[{title:privateText}]});
 store.put("recovery","conflict",{title:privateText});
 store.put("search","task",{words:[privateText]});
 return {directory,key,store,source,filename:path.join(directory,"export.threadbackup"),destination:path.join(directory,"restored.db"),code:backup.newBackupCode()};
}
async function exported(t){const f=fixture(t);f.result=await backup.exportBackup({...f,scope});return f;}
function open(f){return new EncryptedStore({filename:f.destination,key:f.key,scope:storeScope});}
function restore(f,extra={}){return backup.restoreBackup({...f,scope,storeScope,localKey:f.key,...extra});}

test("all buckets and pending originals export encrypted and restore only into a fresh recovery area",async t=>{
 const f=await exported(t);
 assert.equal(f.result.count,6);
 assert.equal(fs.readFileSync(f.filename).includes(Buffer.from(privateText)),false);
 const result=await restore(f);assert.equal(result.status,"REVIEW_REQUIRED");
 const db=open(f);
 try{
  assert.equal(db.entries("confirmed").length,0);
  assert.equal(db.entries("visible").length,0);
  assert.equal(db.entries("outbox").length,0);
  const entries=db.entries("recovery"),marker=db.get("recovery","$imported-backup");
  assert.equal(marker.count,6);assert.equal(entries.length,7);
  const pending=entries.find(row=>row.value.bucket==="outbox");
  assert.equal(pending.value.value.changes[0].title,privateText);
  assert.equal(f.store.get("confirmed","task").title,privateText);
 }finally{db.close();}
 for(const name of fs.readdirSync(f.directory))assert.equal(fs.readFileSync(path.join(f.directory,name)).includes(Buffer.from(privateText)),false);
});

test("wrong code and scope, corrupted data and missing final frame publish no recovery DB",async t=>{
 const f=await exported(t),original=fs.readFileSync(f.filename);
 await assert.rejects(restore(f,{code:backup.newBackupCode()}),/RESTORE_FAILED/);
 await assert.rejects(restore(f,{scope:{...scope,genesisFingerprint:"b".repeat(64)}}),/SCOPE_MISMATCH/);
 const corrupt=Buffer.from(original);corrupt[corrupt.length-20]^=1;
 for(const bytes of [corrupt,original.subarray(0,original.length-20),Buffer.concat([original,Buffer.from([0])])]){
  fs.writeFileSync(f.filename,bytes);
  await assert.rejects(restore(f),/RESTORE_FAILED/);
  assert.equal(fs.existsSync(f.destination),false);
  assert.equal(fs.readdirSync(f.directory).some(name=>name.startsWith(".thread-backup-")),false);
 }
 assert.equal(f.store.get("outbox","pending").changes[0].title,privateText);
});

test("frame duplication, reordering and splicing from another archive are rejected",async t=>{
 const f=await exported(t),original=fs.readFileSync(f.filename),magic=Buffer.from("THREAD-BACKUP\x01","binary").length;
 const frames=[];for(let i=magic;i<original.length;){const n=original.readUInt32BE(i);frames.push(original.subarray(i,i+n+4));i+=n+4;}
 const second=path.join(f.directory,"second.threadbackup");
 await backup.exportBackup({...f,filename:second,scope});
 const other=fs.readFileSync(second),headerEnd=magic+4+other.readUInt32BE(magic);
 const foreign=other.subarray(headerEnd,headerEnd+4+other.readUInt32BE(headerEnd));
 for(const altered of [
  [frames[0],frames[2],frames[1],...frames.slice(3)],
  [frames[0],frames[1],frames[1],...frames.slice(2)],
  [frames[0],foreign,...frames.slice(2)]
 ]){
  fs.writeFileSync(f.filename,Buffer.concat([original.subarray(0,magic),...altered]));
  await assert.rejects(restore(f),/RESTORE_FAILED/);
  assert.equal(fs.existsSync(f.destination),false);
 }
});

test("existing export and restore targets are never replaced; input key is not wiped",async t=>{
 const f=await exported(t),bytes=fs.readFileSync(f.filename);
 await assert.rejects(backup.exportBackup({...f,scope}),/TARGET_EXISTS/);
 assert.deepEqual(fs.readFileSync(f.filename),bytes);
 fs.writeFileSync(f.destination,"existing user file");
 await assert.rejects(restore(f),/TARGET_EXISTS/);
 assert.equal(fs.readFileSync(f.destination,"utf8"),"existing user file");
 assert.deepEqual(f.key,Buffer.alloc(32,7));
 assert.equal(fs.readdirSync(f.directory).some(name=>name.startsWith(".thread-backup-")),false);
});

test("more than one page is verified; locked stores cannot export",async t=>{
 const f=fixture(t);
 f.store.transaction(db=>{
  for(const bucket of ["confirmed","visible","outbox","recovery","search"])for(const row of db.entries(bucket))db.delete(bucket,row.id);
  for(let i=0;i<130;i++)db.put("confirmed",String(i).padStart(4,"0"),{title:"row "+i});
 });
 const result=await backup.exportBackup({...f,scope});assert.equal(result.count,130);
 assert.equal((await restore(f)).count,130);
 f.store.close();
 const next=path.join(f.directory,"locked.threadbackup");
 await assert.rejects(backup.exportBackup({...f,filename:next,scope}),/VAULT_LOCKED/);
 assert.equal(fs.existsSync(next),false);
});

test("empty vault round trip and export scope isolation",async t=>{
 const f=fixture(t);
 await assert.rejects(backup.exportBackup({...f,scope:{...scope,vaultId:"other"}}),/SCOPE_MISMATCH/);
 assert.equal(fs.existsSync(f.filename),false);
 f.store.transaction(db=>{for(const bucket of ["confirmed","visible","outbox","recovery","search"])for(const row of db.entries(bucket))db.delete(bucket,row.id);});
 assert.equal((await backup.exportBackup({...f,scope})).count,0);
 assert.equal((await restore(f)).count,0);
 const db=open(f);try{assert.equal(db.entries("recovery").length,1);assert.equal(db.get("recovery","$imported-backup").count,0);}finally{db.close();}
});
