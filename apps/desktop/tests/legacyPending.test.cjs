const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const sqlite3=require("sqlite3"),{EncryptedStore}=require("../public/electron/e2ee/localStore");
const {preserveLegacyPending}=require("../public/electron/e2ee/legacyPending");
const p=require("../public/electron/e2ee/protocol");
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-legacy-pending-")),filename=path.join(dir,"old.db");
 const db=await new Promise((resolve,reject)=>{const d=new sqlite3.Database(filename,e=>e?reject(e):resolve(d));});
 await new Promise((resolve,reject)=>db.exec(`
 CREATE TABLE sync_meta(key TEXT PRIMARY KEY,value TEXT);
 INSERT INTO sync_meta VALUES ('uid','fixture'),('epoch','old'),('deviceId','old-device');
 CREATE TABLE confirmed_entities(identity TEXT PRIMARY KEY,payload TEXT);
 INSERT INTO confirmed_entities VALUES ('task','SYNTHETIC_PRIVATE_BASE');
 CREATE TABLE outbox(local_order INTEGER PRIMARY KEY,change_id TEXT,request TEXT,status TEXT,ack TEXT,preview_error TEXT);
 INSERT INTO outbox VALUES (1,'pending','SYNTHETIC_PRIVATE_EDIT','pending',NULL,NULL),(2,'unknown','exact request','accepted','original ack',NULL),(3,'done','old','applied',NULL,NULL);
 CREATE TABLE recovery_items(id TEXT PRIMARY KEY,reason TEXT,payload TEXT,created_at INTEGER);
 INSERT INTO recovery_items VALUES ('rejected','CONFLICT','SYNTHETIC_PRIVATE_RECOVERY',1);
 `,e=>e?reject(e):resolve()));
 await new Promise(resolve=>db.close(resolve));
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,5),scope:{environment:"development",accountId:"fixture",vaultId:"vault"},create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,filename,store};
}
test("read-only late-device intake preserves bases, unknown ACK and recovery, without replay",async t=>{
 const f=await fixture(t),before=fs.readFileSync(f.filename);
 const result=await preserveLegacyPending({...f,accountId:"fixture"});
 assert.equal(result.phase,"REVIEW_REQUIRED");assert.equal(result.count,4);
 const rows=f.store.entries("recovery").filter(row=>row.id.includes("-page-")).flatMap(row=>p.decode(row.value).rows);
 assert.equal(rows.filter(row=>row.status==="accepted").length,1);
 assert.equal(rows.filter(row=>row.status==="applied").length,0);
 assert.deepEqual(fs.readFileSync(f.filename),before);
 assert.equal(f.store.entries("outbox").length,0);
 for(const file of fs.readdirSync(f.dir).filter(name=>name.startsWith("vault.db")))
  assert.equal(fs.readFileSync(path.join(f.dir,file)).includes(Buffer.from("SYNTHETIC_PRIVATE")),false);
});
test("wrong account and missing source do not create or reset a source DB",async t=>{
 const f=await fixture(t);
 await assert.rejects(preserveLegacyPending({...f,accountId:"other"}),/ACCOUNT/);
 const missing=path.join(f.dir,"missing.db");
 await assert.rejects(preserveLegacyPending({...f,filename:missing,accountId:"fixture"}));
 assert.equal(fs.existsSync(missing),false);
 assert.equal(f.store.entries("recovery").length,0);
});
test("copy failure never publishes a completed intake or modifies old pending",async t=>{
 const f=await fixture(t),before=fs.readFileSync(f.filename);
 const store={scope:()=>f.store.scope(),put:(bucket,id,value)=>{
  if(id.endsWith("00000001"))throw Error("SYNTHETIC_DISK_FULL");
  f.store.put(bucket,id,value);
 }};
 await assert.rejects(preserveLegacyPending({...f,store,accountId:"fixture"}),/DISK_FULL/);
 const manifests=f.store.entries("recovery").filter(row=>!row.id.includes("-page-"));
 assert.equal(manifests.length,1);assert.equal(manifests[0].value.phase,"COPYING");
 assert.deepEqual(fs.readFileSync(f.filename),before);
 assert.equal(f.store.entries("outbox").length,0);
});
