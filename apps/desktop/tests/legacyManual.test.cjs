const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{createHash}=require("node:crypto");
const p=require("../public/electron/e2ee/protocol"),{EncryptedStore}=require("../public/electron/e2ee/localStore"),{EncryptedReplica}=require("../public/electron/e2ee/replica");
const manual=require("../public/electron/e2ee/legacyManual"),{ApplicationAdapter}=require("../public/electron/e2ee/applicationAdapter");
function fixture(t,actions){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-manual-legacy-"));
 const store=new EncryptedStore({filename:path.join(dir,"vault.db"),key:Buffer.alloc(32,6),scope:{environment:"development",accountId:"synthetic",vaultId:"fixture"},create:true});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const replica=new EncryptedReplica(store,{vaultId:"fixture",epoch:"1",deviceId:"new"}),id="a".repeat(32);
 const rows=actions.map((edit,index)=>({change_id:"change-"+index,local_order:index,status:"pending",request:JSON.stringify({...edit,clientChangeId:"change-"+index})}));
 const bytes=p.encode({table:"outbox",rows}),prefix="$legacy-pending-"+id;
 store.put("recovery",prefix,{phase:"REVIEW_REQUIRED",accountId:"synthetic",pages:1,count:rows.length,bytes:bytes.length,digest:createHash("sha256").update(bytes).digest("hex")});
 store.put("recovery",prefix+"-page-00000000",bytes);
 return {store,replica,id,rows,bytes,prefix};
}
const actions=[
 {entityType:"category",entityId:"cat",operation:"create",changes:{title:"Category"}},
 {entityType:"task",entityId:"task",operation:"create",changes:{title:"Task"},categoryIds:["cat"]},
 {entityType:"subtask",entityId:"child",parentId:"task",operation:"create",changes:{title:"Child"}},
 {entityType:"task",entityId:"task",operation:"patch",changes:{repeat_period:"day",due_date:Date.UTC(2026,8,23),repeat_start_at:Date.UTC(2026,8,23)}}
];
test("dependent structural changes become one new intent, preserving originals and idempotent decisions",t=>{
 const f=fixture(t,actions),review=manual.review(f.replica,{id:f.id});
 const input={id:f.id,changeIds:f.rows.map(row=>row.change_id),expectedRevision:review.revision,choice:"local",confirmed:true};
 const result=manual.resolve(f.replica,input);assert.equal(result.phase,"QUEUED");assert.equal(f.replica.pending().length,1);
 const lists=new ApplicationAdapter(f.replica).lists();assert.equal(lists.tasks.length,1);assert.equal(lists.categories.length,1);assert.equal(lists.subtasks.length,1);assert.equal(lists.relations.length,1);
 assert.equal(lists.tasks[0].repeat_period,"day");
 assert.deepEqual(manual.resolve(f.replica,input),result);
 assert.deepEqual(f.store.get("recovery",f.prefix+"-page-00000000"),f.bytes);
 assert.equal(manual.review(f.replica,{id:f.id}).total,0);
});
test("missing dependencies roll back every draft and stale reviews cannot apply",t=>{
 const f=fixture(t,actions),review=manual.review(f.replica,{id:f.id});
 const input={id:f.id,changeIds:["change-2"],expectedRevision:review.revision,choice:"local",confirmed:true};
 assert.throws(()=>manual.resolve(f.replica,input),/PARENT_DELETED/);assert.equal(f.replica.pending().length,0);
 assert.equal(f.store.entries("visible").length,0);assert.equal(manual.review(f.replica,{id:f.id}).total,4);
 const meta=f.store.get("confirmed","$sync-state");f.store.put("confirmed","$sync-state",{...meta,cursor:"1"});
 assert.throws(()=>manual.resolve(f.replica,input),/REVIEW_CHANGED/);
});
test("keeping current contents archives unknown requests without replaying them",t=>{
 const f=fixture(t,[{entityType:"unknown",entityId:"x",operation:"unknown"}]),review=manual.review(f.replica,{id:f.id});
 assert.equal(review.items[0].unsupported,true);
 const input={id:f.id,changeIds:["change-0"],expectedRevision:review.revision,choice:"current",confirmed:true};
 assert.equal(manual.resolve(f.replica,input).phase,"CURRENT_SELECTED");assert.equal(f.replica.pending().length,0);
 assert.deepEqual(f.store.get("recovery",f.prefix+"-page-00000000"),f.bytes);
});
