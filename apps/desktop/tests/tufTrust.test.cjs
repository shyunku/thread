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
 const targets=signed(new m.Targets({...common,targets:{[target.path]:target}}),"targets");
 const meta=bytes=>new m.MetaFile({version,length:bytes.length,hashes:{sha256:crypto.createHash("sha256").update(bytes).digest("hex")}});
 const snapshot=signed(new m.Snapshot({...common,meta:{"targets.json":meta(targets)}}),"snapshot");
 const timestamp=signed(new m.Timestamp({...common,expires:expired?"2000-01-01T00:00:00Z":common.expires,snapshotMeta:meta(snapshot)}),"timestamp");
 return {rootBytes,targets,snapshot,timestamp,target,data,signers,common,signed};
}
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
