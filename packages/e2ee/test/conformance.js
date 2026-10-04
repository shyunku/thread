// Platform conformance: every platform must reproduce the desktop fixtures byte for byte.
// Returns a list of failures (empty = pass) so Node's test runner and Jest can both use it.
const {Buffer}=require("buffer");
const {fromJson}=require("./json");
const fixtures=require("./fixtures.json");
async function runConformance(){
 const platform=require("../src/platform");
 const p=require("../src/protocol"),m=require("../src/membership"),sync=require("../src/syncProtocol");
 const failures=[],hex=b=>Buffer.from(b).toString("hex");
 const expect=(name,ok)=>{if(!ok)failures.push(name);};
 const attempt=async(name,fn)=>{try{await fn();}catch(error){failures.push(name+": "+error.message);}};
 const rejects=(name,fn)=>{try{fn();failures.push(name);}catch{}};
 for(const [i,item] of fixtures.codec.entries())await attempt("codec "+i,async()=>{
  expect("codec encode "+i,hex(p.encode(fromJson(item.value)))===item.hex);
  expect("codec decode "+i,hex(p.encode(p.decode(Buffer.from(item.hex,"hex"))))===item.hex);
 });
 rejects("non-canonical integer accepted",()=>p.decode(Buffer.from("1801","hex")));
 rejects("duplicate map key accepted",()=>p.decode(Buffer.from("a2616101616102","hex")));
 rejects("trailing bytes accepted",()=>p.decode(Buffer.from("0102","hex")));
 rejects("float accepted",()=>p.encode({a:1.5}));
 await attempt("sha256",async()=>{
  const h=platform.createHash("sha256");for(const part of fixtures.sha256.parts)h.update(part);
  expect("sha256 incremental",h.digest("hex")===fixtures.sha256.hex);
 });
 await attempt("aead vector",async()=>{
  const v=fixtures.aead,secret=Buffer.from(v.secretHex,"hex");
  expect("hkdf derive",hex(p.derive(secret,"field",v.context))===v.derivedKeyHex);
  expect("aad",hex(p.encode([p.SUITE,v.context]))===v.aadHex);
  const value=await p.decrypt(secret,v.context,{nonce:Buffer.from(v.nonceHex,"hex"),ciphertext:Buffer.from(v.ciphertextHex,"hex")});
  expect("aead decrypt",hex(p.encode(value))===v.plaintextHex);
 });
 await attempt("genesis vector",async()=>{
  const state=await m.verifyGenesis(p.decode(Buffer.from(fixtures.genesisVector.genesisHex,"hex")),fixtures.genesisVector.fingerprint);
  expect("genesis fingerprint",state.genesisFingerprint===fixtures.genesisVector.fingerprint);
 });
 await attempt("ed25519 signature",async()=>{
  const s=fixtures.signature,body=fromJson(s.body);
  expect("signature bytes",hex(await p.sign(Buffer.from(s.secretKeyHex,"hex"),s.purpose,body))===s.signatureHex);
  await p.verify(Buffer.from(s.publicKeyHex,"hex"),s.purpose,body,Buffer.from(s.signatureHex,"hex"));
 });
 await attempt("desktop vault records",async()=>{
  const v=fixtures.vault;
  let state=await m.verifyGenesis(p.decode(Buffer.from(v.genesisHex,"hex")),v.fingerprint);
  state=await m.applyMembership(state,p.decode(Buffer.from(v.membershipHex,"hex")));
  expect("membership head",state.head===v.head);
  const key=Buffer.from(v.keyHex,"hex");
  const objects=await sync.decryptBatch(p.decode(Buffer.from(v.batchHex,"hex")),{state,epoch:"1",key});
  expect("batch objects",hex(p.encode(objects))===hex(p.encode(fromJson(v.objects))));
  // A batch made on this platform must pass the same verification.
  const device={signing:{publicKey:state.devices.get("owner").signingKey,privateKey:Buffer.from(fixtures.signature.secretKeyHex,"hex")}};
  const own=await sync.createBatch({state,epoch:"1",deviceId:"owner",device,counter:"8",mutationId:"mutation-2",key,
   changes:[{objectId:"task-3",baseVersion:"0",deleted:false,fields:[{slot:0,value:{title:"왕복"}}]}]});
  const again=await sync.decryptBatch(p.decode(p.encode(own)),{state,epoch:"1",key,lastCounter:"7"});
  expect("own batch round-trip",again[0].fields[0].value.title==="왕복");
 });
 return failures;
}
module.exports={runConformance};
