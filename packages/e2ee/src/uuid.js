// RFC 4122 UUIDs from the platform's random bytes and SHA-1 (no extra dependency).
const {Buffer}=require("buffer");
const {randomBytes,createHash}=require("./platform");
const format=b=>{const h=Buffer.from(b).toString("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;};
function v4(){const b=randomBytes(16);b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;return format(b);}
// Name-based (SHA-1); matches the `uuid` package's v5 and Go's uuid.NewSHA1.
function v5(name,namespace){
 const ns=Buffer.from(namespace.replace(/-/g,""),"hex");if(ns.length!==16)throw Error("INVALID_UUID_NAMESPACE");
 const b=createHash("sha1").update(Buffer.concat([ns,Buffer.from(name,"utf8")])).digest().subarray(0,16);
 b[6]=(b[6]&0x0f)|0x50;b[8]=(b[8]&0x3f)|0x80;return format(b);
}
module.exports={v4,v5};
