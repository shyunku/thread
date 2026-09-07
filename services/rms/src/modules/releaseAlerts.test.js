const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createReleaseAlerts } = require("./releaseAlerts");
const { ensureReleaseSchema } = require("./releaseSchema");
const { createAdminAccess } = require("./adminAccess");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "thread-alert-test-"));
  try {
    const dir = path.join(root, "2.0.0", "alpha", "win");
    fs.mkdirSync(dir, {recursive:true});
    fs.writeFileSync(path.join(dir, "Thread.exe"), "MZfixture");
    const row={version:"2.0.0",verified:1,beta:0,win:1,not_compatible:1};
    let updates=0, auth=true, push=true;
    const db={query:async sql => {if(sql.startsWith("UPDATE")){updates++;return {affectedRows:1}}return [row]}};
    const axios={get:async()=>{if(!auth)throw {response:{status:401}};return {data:{authorized:true}}},
      post:async()=>{if(!push)throw Error("offline");return {data:{published:true,sockets:2}}}};
    const handlers=createReleaseAlerts({db,axios,releaseRoot:()=>root,apiEntry:()=>"http://fixture"});
    const req={body:{version:"2.0.0"},query:{category:"win"},get:()=>"Bearer fixture"};
    const response=()=>({headers:{},set(k,v){this.headers[k]=v},send(value){this.value=value}});
    let res=response();await handlers.publish({...req,get:()=>null},res);assert.equal(res.value.code,401);assert.equal(updates,0);
    auth=false;res=response();await handlers.publish(req,res);assert.equal(res.value.code,401);assert.equal(updates,0);
    auth=true;row.verified=0;res=response();await handlers.publish(req,res);assert.equal(res.value.code,400);assert.equal(updates,0);
    row.verified=1;res=response();await handlers.publish(req,res);assert.equal(res.value.data.sockets,2);assert.equal(updates,1);
    push=false;res=response();await handlers.publish(req,res);assert.equal(res.value.data.delivery,"poll");assert.equal(updates,2);
    res=response();await handlers.latest(req,res);assert.deepEqual(res.value.data,[{version:"2.0.0",beta:false,mandatory:true}]);assert.equal(res.headers["Cache-Control"],"no-store");
    res=response();await handlers.latest({...req,query:{category:"win OR 1=1"}},res);assert.equal(res.value.code,400);
    fs.unlinkSync(path.join(dir,"Thread.exe"));
    res=response();await handlers.publish(req,res);assert.equal(res.value.code,400);assert.equal(updates,2);
    res=response();await handlers.latest(req,res);assert.deepEqual(res.value.data,[]);
    let migrations=0;
    const schema={query:async sql=>{if(sql.startsWith("SELECT"))return migrations?[{}]:[];migrations++;return []}};
    await ensureReleaseSchema(schema);await ensureReleaseSchema(schema);assert.equal(migrations,1);
    await ensureReleaseSchema({query:async sql=>{if(sql.startsWith("SELECT"))return [];throw {code:"ER_DUP_FIELDNAME"}}});
    await assert.rejects(()=>ensureReleaseSchema({query:async()=>{throw Error("db unavailable")}}));
    const access=createAdminAccess({axios,apiEntry:()=>"http://fixture"});
    for (const [body,allowed] of [
      [{beta:false,verified:true,not_compatible:true},true],
      [{beta:true,verified:true,not_compatible:true},false],
      [{beta:false,verified:false,not_compatible:true},false],
      [{beta:true,verified:true,not_compatible:false},true],
      [{beta:false,verified:true,not_compatible:"true"},false],
    ]) {
      let advanced=false;
      const responseObject=response();
      await access({...req,method:"POST",body},responseObject,()=>{advanced=true});
      assert.equal(advanced,allowed);
      if(!allowed)assert.equal(responseObject.value.code,400);
    }
    let advanced=false;
    res=response();await access({...req,method:"PUT",get:()=>null},res,()=>{advanced=true});
    assert.equal(advanced,false);assert.equal(res.value.code,401);
    console.log("RMS alerts passed: mutation auth, policy combinations, verified/file gates, persistence, push fallback, platform whitelist, missing files, idempotent schema.");
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1});
