const sqlite3=require("sqlite3"),{randomBytes,createHash}=require("node:crypto");
const p=require("./protocol");
const all=(db,sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,rows)=>e?reject(e):resolve(rows)));
const exec=(db,sql)=>new Promise((resolve,reject)=>db.exec(sql,e=>e?reject(e):resolve()));
// Recovery intake only. Never opens the old DB writable, acknowledges a v2
// request, or automatically replays an unknown-ACK edit against the new vault.
async function preserveLegacyPending({filename,store,accountId}){
 if(store.scope().accountId!==accountId)throw Error("LEGACY_ACCOUNT_MISMATCH");
 const db=await new Promise((resolve,reject)=>{
  const handle=new sqlite3.Database(filename,sqlite3.OPEN_READONLY,e=>e?reject(e):resolve(handle));
 });
 const id=randomBytes(16).toString("hex"),prefix="$legacy-pending-"+id;
 let started=false;
 try{
  await exec(db,"BEGIN");started=true;
  const meta=Object.fromEntries((await all(db,"SELECT key,value FROM sync_meta WHERE key IN ('uid','epoch','deviceId','seq')")).map(row=>[row.key,row.value]));
  if(meta.uid!==accountId)throw Error("LEGACY_ACCOUNT_MISMATCH");
  store.put("recovery",prefix,{phase:"COPYING",accountId,meta});
  const hash=createHash("sha256");let bytes=0,count=0,pages=0;
  // Preserve bases plus every unresolved request and every existing recovery item.
  // Accepted is not proof of application; it requires reconciliation, not replay.
  const sources=[
   ["confirmed_entities","identity",""],
   ["outbox","local_order","WHERE status<>'applied'"],
   ["recovery_items","id",""]
  ];
  for(const [table,key,where] of sources){
   let after=null;
   for(;;){
    const condition=after===null?where:(where?where+" AND ":"WHERE ")+key+">?";
    const rows=await all(db,"SELECT * FROM "+table+" "+condition+" ORDER BY "+key+" LIMIT 128",after===null?[]:[after]);
    if(!rows.length)break;
    const raw=p.encode({table,rows});
    bytes+=raw.length;count+=rows.length;
    if(bytes>128*1024*1024||count>1000000||raw.length>4*1024*1024)throw Error("LEGACY_RECOVERY_LIMIT");
    hash.update(raw);
    store.put("recovery",prefix+"-page-"+String(pages++).padStart(8,"0"),raw);
    after=rows.at(-1)[key];
   }
  }
  await exec(db,"COMMIT");started=false;
  const manifest={phase:"REVIEW_REQUIRED",accountId,meta,pages,count,bytes,digest:hash.digest("hex")};
  store.put("recovery",prefix,manifest);
  return {id,...manifest};
 }finally{
  if(started)await exec(db,"ROLLBACK").catch(()=>{});
  await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));
 }
}
module.exports={preserveLegacyPending};
