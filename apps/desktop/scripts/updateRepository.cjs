// Offline artifact generator. No root-key use, key generation, upload or deployment.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {createRequire}=require("node:module"),{Readable}=require("node:stream");
const tr=createRequire(require.resolve("tuf-js")),m=tr("@tufjs/models");
const {TrustedMetadataStore}=tr("./store"),versions=require("compare-versions");
const ROLES=["targets","snapshot","timestamp"];
const {promptSecret,loadEncryptedKey}=require('./updateSigningSecrets.cjs');
const check=(ok,code)=>{if(!ok)throw Error(code);};
function read(file,limit=2*1024*1024){
 const fd=fs.openSync(file,"r");
 try{
  const stat=fs.fstatSync(fd);check(stat.isFile()&&stat.size<=limit,"INPUT_FILE_LIMIT");
  const bytes=Buffer.alloc(stat.size+1);let n=0,count;
  while(n<bytes.length&&(count=fs.readSync(fd,bytes,n,bytes.length-n,null))>0)n+=count;
  check(n===stat.size,"INPUT_FILE_CHANGED");return bytes.subarray(0,n);
 }finally{fs.closeSync(fd);}
}
function nameFor(row){
 check(row&&["win","mac"].includes(row.platform)&&["ia32","x64","arm64","universal"].includes(row.arch)&&
  typeof row.version==="string"&&row.version.length<=128&&versions.validate(row.version)&&/^[0-9A-Za-z.+-]+$/.test(row.version)&&
  typeof row.mandatory==="boolean","INVALID_RELEASE");
 check(!(row.mandatory&&row.version.split("+")[0].includes("-")),"BETA_CANNOT_BE_MANDATORY");
 return [row.platform,row.arch,row.version,row.platform==="win"?"installer.exe":"installer.dmg"].join("/");
}
async function digest(file){
 check(fs.lstatSync(file).isFile(),"INVALID_INSTALLER");
 const hash=crypto.createHash("sha256");let length=0;
 for await(const chunk of fs.createReadStream(file)){length+=chunk.length;check(length<=1024*1024*1024,"INSTALLER_TOO_LARGE");hash.update(chunk);}
 check(length>0,"EMPTY_INSTALLER");return {length,hashes:{sha256:hash.digest("hex")}};
}
function signer(root,role,key){
 check(key?.type==="private"&&key.asymmetricKeyType==="ed25519","INVALID_SIGNING_KEY");
 const pub=crypto.createPublicKey(key).export({format:"der",type:"spki"}).subarray(-32).toString("hex"),config=root.signed.roles[role];
 check(config.threshold===1,"UNSUPPORTED_ROLE_THRESHOLD");
 const keyID=config.keyIDs.find(id=>root.signed.keys[id]?.keyVal.public===pub);
 check(keyID&&!root.signed.roles.root.keyIDs.some(id=>root.signed.keys[id]?.keyVal.public===pub),"UNAUTHORIZED_SIGNING_KEY");
 return bytes=>new m.Signature({keyID,sig:crypto.sign(null,bytes,key).toString("hex")});
}
async function buildRepository({rootBytes,keys,releases,output,previous,bootstrap=false,version,expires}){
 check(path.isAbsolute(output)&&!fs.existsSync(output),"OUTPUT_MUST_BE_NEW");
 check(Number.isSafeInteger(version)&&version>0,"INVALID_VERSION");
 check(Array.isArray(releases)&&releases.length<=512,"INVALID_RELEASES");
 check(previous||bootstrap===true,"PREVIOUS_REPOSITORY_REQUIRED");
 const root=m.Metadata.fromJSON("root",JSON.parse(rootBytes));root.verifyDelegate("root",root);
 check(!root.signed.consistentSnapshot,"CONSISTENT_SNAPSHOT_NOT_SUPPORTED");
 const now=Date.now();check(Date.parse(root.signed.expires)>now,"ROOT_EXPIRED");
 const signers={};let expiry=Date.parse(root.signed.expires);
 for(const role of ROLES){
  const next=Date.parse(expires?.[role]);check(Number.isFinite(next)&&next>now&&next<=expiry,"INVALID_EXPIRY");expiry=next;
  signers[role]=signer(root,role,keys[role]);
 }
 check(new Set(ROLES.map(role=>crypto.createPublicKey(keys[role]).export({format:"der",type:"spki"}).toString("hex"))).size===3,"ROLE_KEYS_MUST_DIFFER");
 const targets={},sources=new Map(),catalog=new Map();
 if(previous){
  check(read(path.join(previous,"metadata","root.json")).equals(rootBytes),"ROOT_CHANGE_REQUIRES_SEPARATE_WORKFLOW");
  const old={},bytes={};
  for(const role of ROLES){
   bytes[role]=read(path.join(previous,"metadata",role+".json"));
   old[role]=m.Metadata.fromJSON(role,JSON.parse(bytes[role]));root.verifyDelegate(role,old[role]);
   check(version>old[role].signed.version,"VERSION_ROLLBACK");
  }
  old.timestamp.signed.snapshotMeta.verify(bytes.snapshot);
  old.snapshot.signed.meta["targets.json"].verify(bytes.targets);
  check(old.timestamp.signed.snapshotMeta.version===old.snapshot.signed.version&&old.snapshot.signed.meta["targets.json"].version===old.targets.signed.version,"PREVIOUS_VERSION_MISMATCH");
  const raw=read(path.join(previous,"targets","releases.json"),128*1024);
  await old.targets.signed.targets["releases.json"].verify(Readable.from([raw]));
  const oldCatalog=JSON.parse(raw);check(oldCatalog.schema===1&&Array.isArray(oldCatalog.releases)&&oldCatalog.releases.length<=512,"INVALID_CATALOG");
  for(const row of oldCatalog.releases){
   const name=nameFor({...row,mandatory:false}),target=old.targets.signed.targets[name],attributes=target?.custom?.thread;
   check(attributes?.schema===1&&attributes.platform===row.platform&&attributes.arch===row.arch&&attributes.version===row.version&&typeof attributes.mandatory==="boolean"&&!catalog.has(name),"INVALID_PREVIOUS_TARGET");
   nameFor(attributes);targets[name]=target;sources.set(name,path.join(previous,"targets",name));catalog.set(name,row);
  }
 }
 for(const release of releases){
  const name=nameFor(release);check(!catalog.has(name),"RELEASE_ALREADY_EXISTS");
  targets[name]=new m.TargetFile({path:name,...await digest(release.file),unrecognizedFields:{custom:{thread:{schema:1,platform:release.platform,arch:release.arch,version:release.version,mandatory:release.mandatory}}}});
  sources.set(name,release.file);catalog.set(name,{platform:release.platform,arch:release.arch,version:release.version});
 }
 check(catalog.size>0&&catalog.size<=512,"INVALID_CATALOG");
 const catalogBytes=Buffer.from(JSON.stringify({schema:1,releases:[...catalog.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row)}));
 check(catalogBytes.length<=128*1024,"CATALOG_TOO_LARGE");
 targets["releases.json"]=new m.TargetFile({path:"releases.json",length:catalogBytes.length,hashes:{sha256:crypto.createHash("sha256").update(catalogBytes).digest("hex")}});
 const signed=(value,role)=>{const md=new m.Metadata(value);md.sign(signers[role]);root.verifyDelegate(role,md);return Buffer.from(JSON.stringify(md.toJSON()));};
 const common=role=>({version,specVersion:"1.0.31",expires:expires[role]});
 const meta=bytes=>new m.MetaFile({version,length:bytes.length,hashes:{sha256:crypto.createHash("sha256").update(bytes).digest("hex")}});
 const targetBytes=signed(new m.Targets({...common("targets"),targets}),"targets");
 check(targetBytes.length<=1024*1024,"TARGETS_METADATA_TOO_LARGE");
 const snapshot=signed(new m.Snapshot({...common("snapshot"),meta:{"targets.json":meta(targetBytes)}}),"snapshot");
 const timestamp=signed(new m.Timestamp({...common("timestamp"),snapshotMeta:meta(snapshot)}),"timestamp");
 const verifier=new TrustedMetadataStore(rootBytes);
 verifier.updateTimestamp(timestamp);verifier.updateSnapshot(snapshot);verifier.updateDelegatedTargets(targetBytes,"targets","root");
 for(const [name,file] of sources)await targets[name].verify(fs.createReadStream(file));
 // Exclusive creation; failed partial output has no READY and is never deployed.
 fs.mkdirSync(output,{mode:0o700});
 const write=(relative,bytes)=>{const file=path.join(output,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:"wx",mode:0o600});};
 write("targets/releases.json",catalogBytes);
 for(const [name,file] of sources){
  const dest=path.join(output,"targets",name);fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.copyFileSync(file,dest,fs.constants.COPYFILE_EXCL);await targets[name].verify(fs.createReadStream(dest));
 }
 write("metadata/root.json",rootBytes);write("metadata/"+root.signed.version+".root.json",rootBytes);
 write("metadata/targets.json",targetBytes);write("metadata/snapshot.json",snapshot);write("metadata/timestamp.json",timestamp);
 write("READY",Buffer.from(JSON.stringify({schema:1,version,releases:catalog.size})));
 return {version,releases:catalog.size};
}
if(require.main===module){
 (async()=>{
  check(process.argv.length===3,"USAGE_UPDATE_REPOSITORY_PLAN_JSON");
  const plan=JSON.parse(read(path.resolve(process.argv[2]))),keys={};
  for(const role of ROLES){
   const passphrase=await promptSecret(`${role} key passphrase`);
   try{keys[role]=loadEncryptedKey(path.resolve(plan.keys[role]),passphrase);}
   finally{passphrase.fill(0);}
  }
  console.log(JSON.stringify(await buildRepository({...plan,rootBytes:read(path.resolve(plan.root)),keys})));
 })().catch(()=>{console.error("UPDATE_REPOSITORY_BUILD_FAILED");process.exitCode=1;});
}
module.exports={buildRepository};
