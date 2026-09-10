const {test}=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {createRequire}=require("node:module");
const tufRequire=createRequire(require.resolve("tuf-js"));
const m=tufRequire("@tufjs/models");
const {TrustedMetadataStore}=tufRequire("./store");
function fixture({expired=false,version=2}={}) {
 const common={version,specVersion:"1.0.31",expires:new Date(Date.now()+3600000).toISOString()};
 const keys={},signers={};
 for(const role of ["root","targets","snapshot","timestamp"]){
  const pair=crypto.generateKeyPairSync("ed25519");
  const pub=pair.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
  keys[role]=new m.Key({keyID:role,keyType:"ed25519",scheme:"ed25519",keyVal:{public:pub}});
  signers[role]=data=>new m.Signature({keyID:role,sig:crypto.sign(null,data,pair.privateKey).toString("hex")});
 }
 function signed(value,role) {
  const md=new m.Metadata(value);md.sign(signers[role]);
  return Buffer.from(JSON.stringify(md.toJSON()));
 }
 const root=new m.Root({...common,version:1,consistentSnapshot:false});
 for(const role of Object.keys(keys)) root.addKey(keys[role],role);
 const rootBytes=signed(root,"root");
 const data=Buffer.from("MZ-synthetic-installer");
 const target=new m.TargetFile({path:"win/ia32/1.1.4/installer.exe",length:data.length,
  hashes:{sha256:crypto.createHash("sha256").update(data).digest("hex")},
  unrecognizedFields:{custom:{thread:{schema:1,platform:"win",arch:"ia32",version:"1.1.4",mandatory:true}}}});
 const catalogData=Buffer.from(JSON.stringify({schema:1,releases:[{platform:"win",arch:"ia32",version:"1.1.4"}]}));
 const catalog=new m.TargetFile({path:"releases.json",length:catalogData.length,hashes:{sha256:crypto.createHash("sha256").update(catalogData).digest("hex")}});
 const targets=signed(new m.Targets({...common,targets:{[target.path]:target,"releases.json":catalog}}),"targets");
 const meta=bytes=>new m.MetaFile({version,length:bytes.length,hashes:{sha256:crypto.createHash("sha256").update(bytes).digest("hex")}});
 const snapshot=signed(new m.Snapshot({...common,meta:{"targets.json":meta(targets)}}),"snapshot");
 const timestamp=signed(new m.Timestamp({...common,expires:expired?"2000-01-01T00:00:00Z":common.expires,snapshotMeta:meta(snapshot)}),"timestamp");
 return {rootBytes,targets,snapshot,timestamp,target,data,catalogData,signers,common,signed};
}
test("application discovery uses a verified catalog and refuses modified cache bytes",async t=>{
 const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),vm=require("node:vm");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thread-trusted-catalog-")),rootFile=path.join(dir,"root.json"),f=fixture();
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(rootFile,f.rootBytes);
 let store,tamper=false;
 class Client{
  async refresh(){store=new TrustedMetadataStore(f.rootBytes);store.updateTimestamp(f.timestamp);store.updateSnapshot(f.snapshot);store.updateDelegatedTargets(f.targets,"targets","root");}
  async getTargetInfo(name){return store.targets.signed.targets[name];}
  async downloadTarget(info){
   const file=path.join(dir,path.basename(info.path));fs.writeFileSync(file,tamper?Buffer.from("changed"):f.catalogData);return file;
  }
 }
 const exported={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve("../public/electron/e2ee/trustedUpdates"),"utf8"),{URL,module:exported,require:id=>id==="tuf-js"?{Updater:Client}:require(id)});
 const trust=new exported.exports.TrustedUpdates({rootFile,cacheDir:path.join(dir,"cache"),repositoryURL:"https://fixture.invalid/tuf/",platform:"win",arch:"ia32",installedVersion:"1.1.3"});
 const release=await trust.latest();assert.equal(release.version,"1.1.4");assert.equal(release.mandatory,true);
 tamper=true;await assert.rejects(trust.latest());
 assert.throws(()=>new exported.exports.TrustedUpdates({rootFile:path.join(dir,"absent"),cacheDir:dir,repositoryURL:"https://fixture.invalid",platform:"win",arch:"x64",installedVersion:"1.1.3"}),/TRUST_NOT_CONFIGURED/);
});
test("real TUF validates role signatures, hash/length and signed target attributes",async()=>{
 const f=fixture(), store=new TrustedMetadataStore(f.rootBytes);
 store.updateTimestamp(f.timestamp);store.updateSnapshot(f.snapshot);
 store.updateDelegatedTargets(f.targets,"targets","root");
 const info=store.targets.signed.targets[f.target.path];
 assert.equal(info.custom.thread.mandatory,true);
 const {Readable}=require("node:stream");
 await info.verify(Readable.from([f.data]));
 await assert.rejects(info.verify(Readable.from([Buffer.from("MZ-bad")]))); 
});

test("single offline root authorizes renewal but online role keys cannot replace it",()=>{
 const f=fixture(),root=JSON.parse(f.rootBytes);
 assert.equal(root.signed.roles.root.threshold,1);
 assert.equal(root.signed.roles.root.keyids.length,1);
 for(const role of ["targets","snapshot","timestamp"])assert.notEqual(root.signed.roles[role].keyids[0],root.signed.roles.root.keyids[0]);
 const next=m.Root.fromJSON({...root.signed,version:2});
 const store=new TrustedMetadataStore(f.rootBytes);
 assert.throws(()=>store.updateRoot(f.signed(next,"targets")));
 store.updateRoot(f.signed(next,"root"));
 assert.equal(store.root.signed.version,2);
 assert.throws(()=>store.updateRoot(f.rootBytes));
});
test("real TUF rejects modified mandatory metadata, expiry and timestamp rollback",()=>{
 const f=fixture();
 const invalid=JSON.parse(f.targets);invalid.signed.targets[f.target.path].custom.thread.mandatory=false;
 const store=new TrustedMetadataStore(f.rootBytes);
 store.updateTimestamp(f.timestamp);store.updateSnapshot(f.snapshot);
 assert.throws(()=>store.updateDelegatedTargets(Buffer.from(JSON.stringify(invalid)),"targets","root"));
 const old=f.signed(new m.Timestamp({...f.common,version:1}),"timestamp");
 assert.throws(()=>store.updateTimestamp(old));
 const expired=fixture({expired:true}), s=new TrustedMetadataStore(expired.rootBytes);
 try {s.updateTimestamp(expired.timestamp);} catch(error) {assert.match(error.message,/expired/i);return;}
 assert.throws(()=>s.updateSnapshot(expired.snapshot),/expired/i);
});
