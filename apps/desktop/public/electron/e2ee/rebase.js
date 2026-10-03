const p=require("./protocol");
// Conflict policy (task 94): re-apply only what this device changed onto the latest
// version. A value changed on both sides keeps the version that reached the server
// first; a deleted object stays deleted. Nothing is merged on the server (E2EE).
const same=(a,b)=>p.encode(a??null).equals(p.encode(b??null));
const plain=value=>!!value&&typeof value==="object"&&!Array.isArray(value)&&!Buffer.isBuffer(value)&&!(value instanceof Uint8Array);
function pick(base,local,current){return same(local,base)||!same(current,base)?current:local;}
function mergeEntries(base,local,current,special){
 const out={};
 for(const key of [...new Set([...Object.keys(base),...Object.keys(current),...Object.keys(local)])].sort()){
  const value=special?.(key,base[key],local[key],current[key])??pick(base[key],local[key],current[key]);
  if(value!==undefined)out[key]=value;
 }
 return out;
}
// Application rows: {entityType, entityId, operation, fields:{...}, ...}. Merge one level into fields.
function mergeRow(base,local,current){
 return mergeEntries(base,local,current,(key,b,l,c)=>{
  if(key==="version")return c;
  if(key!=="fields"||!plain(l)||!plain(c))return undefined;
  return mergeEntries(plain(b)?b:{},l,c,(field,_b,lv,cv)=>
   field==="updated_at"&&Number.isFinite(lv)&&Number.isFinite(cv)?Math.max(lv,cv):undefined);
 });
}
function mergeFields(base,local,current){
 const map=list=>new Map((list||[]).map(field=>[field.slot,field.value]));
 const b=map(base),l=map(local),c=map(current),out=[];
 for(const slot of [...new Set([...b.keys(),...c.keys(),...l.keys()])].sort((x,y)=>x-y)){
  const bv=b.get(slot),lv=l.get(slot),cv=c.get(slot);
  const value=plain(lv)&&plain(cv)&&!same(lv,cv)?mergeRow(plain(bv)?bv:{},lv,cv):pick(bv,lv,cv);
  if(value!==undefined)out.push({slot,value});
 }
 return out;
}
// base: the object this change was made on (null for a create); current: the latest
// local view of the object (confirmed, or an earlier pending edit's overlay).
// Returns the change to queue against current, or null when nothing is left to send.
function rebaseChange(base,change,current){
 if(!current){if(change.baseVersion==="0")return change;throw Error("REBASE_CURRENT_MISSING");}
 if(current.deleted)return null;
 const head={objectId:change.objectId,baseVersion:current.version};
 if(change.deleted)return {...head,deleted:true,fields:[]};
 const fields=mergeFields(base&&!base.deleted?base.fields:[],change.fields,current.fields);
 if(!fields.length||same(fields,current.fields))return null;
 return {...head,deleted:false,fields};
}
module.exports={rebaseChange,mergeRow};
