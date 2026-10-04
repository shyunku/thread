// JSON form for fixture values: byte strings become {"$bytes":"hex"}.
const {Buffer}=require("buffer");
function toJson(value){
 if(Buffer.isBuffer(value)||value instanceof Uint8Array)return {$bytes:Buffer.from(value).toString("hex")};
 if(Array.isArray(value))return value.map(toJson);
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,toJson(v)]));
 return value;
}
function fromJson(value){
 if(Array.isArray(value))return value.map(fromJson);
 if(value&&typeof value==="object"){
  if(Object.keys(value).length===1&&typeof value.$bytes==="string")return Buffer.from(value.$bytes,"hex");
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,fromJson(v)]));
 }
 return value;
}
module.exports={toJson,fromJson};
