const test=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{createRequire}=require("node:module");
const tr=createRequire(require.resolve("tuf-js")),m=tr("@tufjs/models"),{TrustedMetadataStore}=tr("./store");
const {buildRepository}=require("../scripts/updateRepository.cjs");
const {verifyUpdateRepository}=require('../scripts/verifyUpdateRepository.cjs');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"thread-signing-synthetic-"));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const expires=new Date(Date.now()+86400000).toISOString(),root=new m.Root({version:1,specVersion:"1.0.31",expires,consistentSnapshot:false}),keys={};
 for(const role of ["root","targets","snapshot","timestamp"]){
  const pair=crypto.generateKeyPairSync("ed25519");keys[role]=pair.privateKey;
  root.addKey(new m.Key({keyID:role,keyType:"ed25519",scheme:"ed25519",keyVal:{public:pair.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex")}}),role);
 }
 const md=new m.Metadata(root);md.sign(data=>new m.Signature({keyID:"root",sig:crypto.sign(null,data,keys.root).toString("hex")}));
 const file=path.join(directory,"synthetic.exe");fs.writeFileSync(file,"MZ-SYNTHETIC-ONLY");
 const options={rootBytes:Buffer.from(JSON.stringify(md.toJSON())),keys,bootstrap:true,version:1,
  expires:{targets:expires,snapshot:expires,timestamp:expires},output:path.join(directory,"repo1"),
  releases:[{file,platform:"win",arch:"x64",version:"2.0.0",mandatory:true}]};
 return {directory,options};
}
test('read-only publication preflight verifies app root and every signed target',async t=>{
 const {options,directory}=fixture(t);
 await buildRepository(options);
 const appRoot=path.join(directory,'app-root.json');
 fs.writeFileSync(appRoot,options.rootBytes);
 const result=await verifyUpdateRepository(options.output,appRoot);
 assert.equal(result.releases,1);
 fs.writeFileSync(appRoot,Buffer.from('{}'));
 await assert.rejects(verifyUpdateRepository(options.output,appRoot),/APP_ROOT_MISMATCH/);
 fs.writeFileSync(appRoot,options.rootBytes);
 fs.appendFileSync(path.join(options.output,'targets/win/x64/2.0.0/installer.exe'),'tampered');
 await assert.rejects(verifyUpdateRepository(options.output,appRoot));
});
test("signed public repository validates with actual client and retains mandatory catalog on renewal",async t=>{
 const {options,directory}=fixture(t);await buildRepository(options);
 const next={...options,bootstrap:false,version:2,previous:options.output,output:path.join(directory,"repo2"),
  releases:[{...options.releases[0],version:"2.0.1",mandatory:false}]};
 await buildRepository(next);
 const store=new TrustedMetadataStore(options.rootBytes),read=name=>fs.readFileSync(path.join(next.output,"metadata",name+".json"));
 store.updateTimestamp(read("timestamp"));store.updateSnapshot(read("snapshot"));store.updateDelegatedTargets(read("targets"),"targets","root");
 assert.equal(store.targets.signed.targets["win/x64/2.0.0/installer.exe"].custom.thread.mandatory,true);
 assert.equal(JSON.parse(fs.readFileSync(path.join(next.output,"targets/releases.json"))).releases.length,2);
 await store.targets.signed.targets["win/x64/2.0.1/installer.exe"].verify(fs.createReadStream(path.join(next.output,"targets/win/x64/2.0.1/installer.exe")));
 assert.ok(fs.existsSync(path.join(next.output,"READY")));
 assert.deepEqual(fs.readdirSync(next.output).sort(),["READY","metadata","targets"]);
});
test("rollback, replacement, role misuse, missing previous and invalid expiry fail before publication",async t=>{
 const {options,directory}=fixture(t);await buildRepository(options);
 const output=path.join(directory,"rejected");
 for(const [extra,pattern] of [
  [{version:1,previous:options.output},/VERSION_ROLLBACK/],
  [{keys:{...options.keys,targets:options.keys.root}},/UNAUTHORIZED_SIGNING_KEY/],
  [{bootstrap:false},/PREVIOUS_REPOSITORY_REQUIRED/],
  [{expires:{...options.expires,timestamp:"2000-01-01T00:00:00Z"}},/INVALID_EXPIRY/],
  [{releases:[{...options.releases[0],version:"../escape"}]},/INVALID_RELEASE/],
  [{releases:[{...options.releases[0],version:"2.0.1-beta"}]},/BETA_CANNOT_BE_MANDATORY/],
  [{version:2,previous:options.output},/RELEASE_ALREADY_EXISTS/]
 ]){
  await assert.rejects(buildRepository({...options,output,...extra}),pattern);assert.equal(fs.existsSync(output),false);
 }
 await assert.rejects(buildRepository(options),/OUTPUT_MUST_BE_NEW/);
});
test("modified previous public artifacts cannot be carried into a renewed signed repository",async t=>{
 const {options,directory}=fixture(t);await buildRepository(options);
 fs.appendFileSync(path.join(options.output,"targets/win/x64/2.0.0/installer.exe"),"tampered");
 const output=path.join(directory,"rejected");
 await assert.rejects(buildRepository({...options,version:2,previous:options.output,output,releases:[]}));
 assert.equal(fs.existsSync(output),false);
});
test("authenticode gate requires the expected embedded timestamped signer",{skip:process.platform!=="win32"},async t=>{
 const {inspectAuthenticode,verifyAuthenticode}=require('../scripts/verifyUpdateRepository.cjs');
 const signed=inspectAuthenticode(process.execPath);
 if(signed.status!=="Valid"||signed.type!=="Authenticode")return t.skip("node.exe is not Authenticode-signed");
 assert.equal(verifyAuthenticode(process.execPath,signed.thumbprint.toUpperCase()).status,"Valid");
 assert.throws(()=>verifyAuthenticode(process.execPath,"0".repeat(40)),/AUTHENTICODE_SIGNER_MISMATCH/);
 assert.throws(()=>verifyAuthenticode(process.execPath,"not-a-thumbprint"),/INVALID_AUTHENTICODE_THUMBPRINT/);
 const {options,directory}=fixture(t);await buildRepository(options);
 const appRoot=path.join(directory,'app-root.json');fs.writeFileSync(appRoot,options.rootBytes);
 await assert.rejects(verifyUpdateRepository(options.output,appRoot,{authenticode:signed.thumbprint.toUpperCase()}),/AUTHENTICODE_NOT_VALID/);
});
test("published repository check compares every served public byte",async t=>{
 const http=require("node:http"),{verifyPublishedRepository}=require('../scripts/verifyPublishedRepository.cjs');
 const {options}=fixture(t);await buildRepository(options);
 const overrides={};
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(req.url.replace(/^\/tuf\//,""));
  if(overrides[name]!==undefined){if(overrides[name]===null){res.statusCode=404;return res.end();}return res.end(overrides[name]);}
  const file=path.join(options.output,...name.split("/"));
  if(!/^(metadata|targets)\//.test(name)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>server.close());
 const url=`http://127.0.0.1:${server.address().port}/tuf`;
 assert.equal((await verifyPublishedRepository(url,options.output)).files,7);
 overrides["targets/win/x64/2.0.0/installer.exe"]="MZ-SYNTHETIC-ONLX";
 await assert.rejects(verifyPublishedRepository(url,options.output),/SERVED_FILE_MISMATCH:targets\/win\/x64\/2.0.0\/installer.exe/);
 overrides["targets/win/x64/2.0.0/installer.exe"]="MZ-SYNTHETIC-ONLY-appended";
 await assert.rejects(verifyPublishedRepository(url,options.output),/SERVED_FILE_SIZE_MISMATCH/);
 overrides["targets/win/x64/2.0.0/installer.exe"]=null;
 await assert.rejects(verifyPublishedRepository(url,options.output),/SERVED_FILE_MISSING:404/);
 await assert.rejects(verifyPublishedRepository("http://rms.example.com/tuf",options.output),/HTTPS_REQUIRED/);
});
