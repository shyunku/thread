const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("fs-extra"),os=require("os"),path=require("path"),{Readable}=require("stream");
const {downloadRelease}=require("../public/electron/modules/downloadRelease");
test("download validates installer and removes partial files on stream/JSON errors",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"thread-download-test-"));
 try {
  const args={serverHost:"http://fixture",userDataPath:root,category:"win",version:"2.0.0"};
  const axios={get:async()=>({headers:{"content-type":"application/octet-stream"},data:Readable.from([Buffer.from("MZfixture")])})};
  const target=await downloadRelease({...args,axios});
  assert.equal(await fs.readFile(target,"utf8"),"MZfixture");
  await assert.rejects(()=>downloadRelease({...args,axios:{get:async()=>({headers:{"content-type":"application/json"},data:Readable.from(["error"])})}}));
  assert.equal(await fs.readFile(target,"utf8"),"MZfixture");
  await assert.rejects(()=>downloadRelease({...args,axios:{get:async()=>({headers:{},data:Readable.from((async function*(){yield Buffer.from("MZ");throw Error("disconnected")})())})}}));
  assert.equal(await fs.pathExists(target+".partial"),false);
  assert.equal(await fs.readFile(target,"utf8"),"MZfixture");
  await assert.rejects(()=>downloadRelease({...args,version:"../escape",axios}));
 } finally {await fs.remove(root)}
});
