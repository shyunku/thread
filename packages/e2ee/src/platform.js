// The only place the shared E2EE code touches platform crypto. Each app installs
// its own implementation once at startup (desktop: Node, mobile: React Native).
// Every implementation must pass the same golden vectors; nothing here falls back
// to a weaker primitive when one is missing.
const {Buffer}=require("buffer");
const REQUIRED=["sodium","cbor","hkdf","createHash","randomBytes"];
let impl=null;
function install(platform){
 if(!platform||REQUIRED.some(key=>platform[key]==null)||typeof platform.cbor.encode!=="function"||typeof platform.cbor.decode!=="function")throw Error("E2EE_PLATFORM_INVALID");
 if(impl&&impl!==platform)throw Error("E2EE_PLATFORM_ALREADY_INSTALLED");
 impl=platform;
}
function need(){if(!impl)throw Error("E2EE_PLATFORM_MISSING");return impl;}
// libsodium-wrappers compatible API (sodium.ready, crypto_* functions).
const sodium=new Proxy({},{get:(_,key)=>{const s=need().sodium,value=s[key];return typeof value==="function"?value.bind(s):value;}});
// Constant-time comparison with the same contract as Node's timingSafeEqual.
function timingSafeEqual(a,b){
 if(a.length!==b.length)throw Error("ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH");
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 return diff===0;
}
module.exports={
 install,
 installed:()=>impl!=null,
 sodium,
 // canonical CBOR (RFC 7049 length-first key order); decode rejects duplicate keys and deep nesting
 // decodeLocal (optional): the same decoding for trusted local records, may skip pre-checks
 cbor:{encode:value=>Buffer.from(need().cbor.encode(value)),decode:bytes=>need().cbor.decode(bytes),
  decodeLocal:bytes=>(need().cbor.decodeLocal||need().cbor.decode)(bytes)},
 // HKDF-SHA256(secret, salt, info, length) -> Buffer
 hkdf:(secret,salt,info,length)=>Buffer.from(need().hkdf(secret,salt,info,length)),
 // Node-style incremental hash: createHash("sha256").update(x).digest(encoding?)
 createHash:algorithm=>need().createHash(algorithm),
 randomBytes:size=>Buffer.from(need().randomBytes(size)),
 timingSafeEqual,
};
