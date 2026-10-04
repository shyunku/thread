// Node implementation of the shared E2EE platform (packages/e2ee/src/platform.js).
// Desktop behaviour must stay byte-identical: same cbor options and Node crypto.
const sodium=require("libsodium-wrappers"),cbor=require("cbor");
const {hkdfSync,createHash,randomBytes}=require("node:crypto");
const shared=require("@thread/e2ee/src/platform");
const MAX_BYTES=1024*1024;
if(!shared.installed())shared.install({
 sodium,
 cbor:{
  // Synchronous cbor encoding can stop at the stream high-water mark.
  // Keep it above our accepted size so a partial result can never be accepted.
  encode:value=>cbor.encodeOne(value,{canonical:true,highWaterMark:MAX_BYTES+1}),
  decode:bytes=>cbor.decodeFirstSync(bytes,{preventDuplicateKeys:true,max_depth:24}),
 },
 hkdf:(secret,salt,info,length)=>hkdfSync("sha256",secret,salt,info,length),
 createHash,
 randomBytes,
});
module.exports=shared;
