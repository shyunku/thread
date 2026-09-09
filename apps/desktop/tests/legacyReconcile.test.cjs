const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{createHash}=require("node:crypto");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const {compareEdit,reconcileLegacyPending}=require("../public/electron/e2ee/legacyReconcile"),p=require("../public/electron/e2ee/protocol");
const base={entityType:"task",entityId:"old",operation:"upsert",version:"2",fields:{title:"before",memo:"memo",deleted_at:null}};
const entry=(change_id="edit",changes={title:"after"})=>({change_id,status:"pending",request:JSON.stringify({clientChangeId:change_id,entityType:"task",entityId:"old",operation:"patch",baseVersion:"2",changes})});
test("three-way field merge preserves remote unrelated edits and rejects ambiguity",()=>{
 const remote={...base,fields:{...base.fields,memo:"remote memo"}};
 assert.deepEqual(compareEdit(entry(),base,remote).row.fields,{...remote.fields,title:"after"});
 assert.equal(compareEdit(entry(),base,{...base,fields:{...base.fields,title:"other"}}).reason,"FIELD_CONFLICT");
 assert.equal(compareEdit(entry(),base,{...base,operation:"delete"}).reason,"DELETED_OR_MISSING");
 assert.equal(compareEdit({...entry(),status:"accepted"},base,base).reason,"ACK_OR_REJECTION_REVIEW");
 assert.equal(compareEdit(entry("edit",{done:true}),base,base).reason,"DEPENDENT_FIELDS");
 assert.equal(compareEdit(entry(),{...base,version:"1"},base).reason,"BASE_UNAVAILABLE");
 assert.equal(compareEdit(entry(),base,{...base,fields:{...base.fields,title:"after"}}).status,"ALREADY_PRESENT");
});
function fixture(t,entries=[entry()]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-reconcile-"));
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,6),scope:{environment:"development",accountId:"fixture",vaultId:"vault"},create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const replica=new EncryptedReplica(store,{vaultId:"vault",epoch:"new",deviceId:"device"}),id="a".repeat(32);
 store.put("confirmed","opaque",{objectId:"opaque",version:"7",deleted:false,fields:[{slot:0,value:base}]});
 const pages=[{table:"confirmed_entities",rows:[{identity:"old",payload:JSON.stringify(base)}]},{table:"outbox",rows:entries}].map(p.encode);
 pages.forEach((raw,i)=>store.put("recovery","$legacy-pending-"+id+"-page-"+String(i).padStart(8,"0"),raw));
 store.put("recovery","$legacy-pending-"+id,{phase:"REVIEW_REQUIRED",accountId:"fixture",pages:pages.length,count:entries.length+1,bytes:pages.reduce((n,r)=>n+r.length,0),digest:createHash("sha256").update(Buffer.concat(pages)).digest("hex")});
 return {store,replica,id};
}
test("conversion queues once and retains originals; dependent edits require review",t=>{
 const f=fixture(t,[entry(),entry("next",{memo:"next memo"})]);
 assert.deepEqual(reconcileLegacyPending(f),{queued:1,review:1,present:0,previous:0});
 assert.equal(f.replica.pending().length,1);
 assert.equal(f.replica.pending()[0].value.changes[0].baseVersion,"7");
 assert.deepEqual(reconcileLegacyPending(f),{queued:0,review:0,present:0,previous:2});
 assert.equal(f.replica.pending().length,1);
 assert.ok(f.store.get("recovery","$legacy-pending-"+f.id+"-page-00000001"));
 assert.equal(f.store.get("confirmed","opaque").fields[0].value.fields.title,"before");
});
test("corrupt intake or failed decision write commits neither a draft nor a counter",t=>{
 const f=fixture(t),put=f.store.put.bind(f.store);
 f.store.put=(bucket,key,value)=>{if(key.startsWith("$legacy-decision"))throw Error("SYNTHETIC_DISK_FULL");return put(bucket,key,value);};
 assert.throws(()=>reconcileLegacyPending(f),/DISK_FULL/);
 assert.equal(f.replica.pending().length,0);
 assert.equal(f.store.get("confirmed","$sync-state").counter,"0");
 f.store.put=put;
 const key="$legacy-pending-"+f.id+"-page-00000001";
 put("recovery",key,p.encode({table:"outbox",rows:[]}));
 assert.throws(()=>reconcileLegacyPending(f),/DIGEST/);
 assert.equal(f.replica.pending().length,0);
});
test("review API is lock-gated, paginated and excludes raw requests",async t=>{
 const f=fixture(t,[{...entry(),status:"accepted"}]);
 reconcileLegacyPending(f);
 const {createVaultController}=require("../public/electron/e2ee/vaultController");
 const controller=createVaultController({vault:{open:()=>f.store},osAuth:{verify:async()=>true},getWindow:()=>null,clearRenderer:()=>{}});
 assert.throws(()=>controller.legacyReviews({id:f.id}),/LOCKED/);
 await controller.unlock("os");
 const result=controller.legacyReviews({id:f.id,limit:1});
 assert.equal(result.total,1);assert.equal(result.next,null);
 assert.equal(result.items[0].local.title,"after");
 assert.equal(result.items[0].original.title,"before");
 assert.equal(Object.hasOwn(result.items[0],"request"),false);
 assert.throws(()=>controller.legacyReviews({id:f.id,limit:51}),/INVALID_REVIEW_PAGE/);
 controller.lock();assert.throws(()=>controller.legacyReviews({id:f.id}),/LOCKED/);
 controller.dispose();
});
