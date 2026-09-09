// Main-process only. Imports are recovery copies, never a live replica cutover.
const fs=require("node:fs"),path=require("node:path");
const {randomBytes,createHash}=require("node:crypto");
const sodium=require("libsodium-wrappers"),p=require("./protocol");
const {formatCode,parseCode}=require("./recoveryFile");
const {EncryptedStore}=require("./localStore");
const MAGIC=Buffer.from("THREAD-BACKUP\x01","binary");
const BUCKETS=["confirmed","visible","outbox","recovery","search"];
const MAX_FILE=128*1024*1024,MAX_RECORDS=100000;
function check(ok,code="INVALID_DATA_BACKUP"){if(!ok)throw Error(code);}
function scope(value){
 check(value&&Object.keys(value).length===2&&typeof value.vaultId==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value.vaultId)&&
  typeof value.genesisFingerprint==="string"&&/^[a-f0-9]{64}$/.test(value.genesisFingerprint),"INVALID_BACKUP_SCOPE");
 return value;
}
function location(filename){check(typeof filename==="string"&&path.isAbsolute(filename),"INVALID_BACKUP_PATH");}
function tempFor(filename){return path.join(path.dirname(filename),".thread-backup-"+randomBytes(16).toString("hex"));}
function newBackupCode(){const secret=randomBytes(32);try{return formatCode(secret);}finally{secret.fill(0);}}
function archiveKey(code,header){const secret=parseCode(code);try{return p.derive(secret,"data-backup",header);}finally{secret.fill(0);}}
function aad(header,index){return p.encode([p.SUITE,"data-backup",header,index]);}
function encrypt(key,header,index,value){
 const plain=p.encode(value),nonce=randomBytes(24);
 try{return p.encode({nonce,ciphertext:Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plain,aad(header,index),null,nonce,key))});}
 finally{plain.fill(0);}
}
function decrypt(key,header,index,raw){
 const envelope=p.decode(raw);
 check(envelope&&Object.keys(envelope).length===2&&Buffer.isBuffer(envelope.nonce)&&envelope.nonce.length===24&&Buffer.isBuffer(envelope.ciphertext)&&envelope.ciphertext.length>=16);
 let plain;
 try{
  plain=Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null,envelope.ciphertext,aad(header,index),envelope.nonce,key));
  return p.decode(plain);
 }finally{plain?.fill(0);}
}
function writeAll(fd,bytes){let offset=0;while(offset<bytes.length){const n=fs.writeSync(fd,bytes,offset,bytes.length-offset);check(n>0,"BACKUP_WRITE_FAILED");offset+=n;}}
function writeFrame(fd,bytes){check(bytes.length<=p.MAX_BYTES);const size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);writeAll(fd,size);writeAll(fd,bytes);return size.length+bytes.length;}
function reader(fd,size){
 let offset=0;
 const take=n=>{
  check(Number.isInteger(n)&&n>=0&&n<=p.MAX_BYTES&&offset+n<=size);
  const bytes=Buffer.alloc(n);let done=0;
  while(done<n){const count=fs.readSync(fd,bytes,done,n-done,offset+done);check(count>0);done+=count;}
  offset+=n;return bytes;
 };
 return {take,frame:()=>{const n=take(4).readUInt32BE();check(n>0);return take(n);},ended:()=>offset===size};
}
function publish(temp,destination){
 // Same-directory hard link is atomic and fails if the destination exists.
 // renameSync would overwrite an existing export on some platforms.
 fs.linkSync(temp,destination);fs.unlinkSync(temp);
}
function removeOwned(temp){for(const suffix of ["-wal","-shm",""]){try{fs.unlinkSync(temp+suffix);}catch(e){if(e.code!=="ENOENT")throw e;}}}

async function exportBackup({store,filename,code,scope:expected}){
 await sodium.ready;location(filename);scope(expected);
 check(store.scope().vaultId===expected.vaultId,"BACKUP_SCOPE_MISMATCH");
 const header={schema:1,kind:"thread-encrypted-backup",...expected,id:randomBytes(16).toString("hex")};
 const key=archiveKey(code,header),temp=tempFor(filename);let fd,owned=false;
 try{
  fd=fs.openSync(temp,"wx",0o600);owned=true;writeAll(fd,MAGIC);
  let bytes=MAGIC.length+writeFrame(fd,p.encode(header)),count=0;
  // Synchronous read transaction pins all buckets to one checkpoint, without
  // collecting the entire vault in RAM. No async callback inside SQLite.
  store.transaction(db=>{
   for(const bucket of BUCKETS){
    let after="";
    for(;;){
     const rows=db.entries(bucket,after,64);
     for(const row of rows){
      check(count<MAX_RECORDS,"BACKUP_LIMIT");
      const encrypted=encrypt(key,header,count,{kind:"record",bucket,id:row.id,value:row.value});
      check(bytes+4+encrypted.length<=MAX_FILE,"BACKUP_LIMIT");
      bytes+=writeFrame(fd,encrypted);count++;after=row.id;
     }
     if(rows.length<64)break;
    }
   }
  });
  const end=encrypt(key,header,count,{kind:"complete",count});
  check(bytes+4+end.length<=MAX_FILE,"BACKUP_LIMIT");writeFrame(fd,end);
  fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  publish(temp,filename);owned=false;return {id:header.id,count};
 }catch(error){
  if(["BACKUP_LIMIT","VAULT_LOCKED","ENCODING_SIZE"].includes(error.message))throw error;
  throw Error(error.code==="EEXIST"?"BACKUP_TARGET_EXISTS":"BACKUP_EXPORT_FAILED");
 }finally{key.fill(0);if(fd!==undefined)fs.closeSync(fd);if(owned)fs.unlinkSync(temp);}
}

async function restoreBackup({filename,destination,code,scope:expected,localKey,storeScope}){
 await sodium.ready;location(filename);location(destination);scope(expected);
 check(storeScope?.vaultId===expected.vaultId,"BACKUP_SCOPE_MISMATCH");
 check(Buffer.isBuffer(localKey)&&localKey.length===32,"INVALID_LDK");
 const tempDirectory=tempFor(destination),temp=path.join(tempDirectory,"recovery.db");let input,db,key,owned=false;
 try{
  const stat=fs.lstatSync(filename);
  check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>MAGIC.length&&stat.size<=MAX_FILE);
  input=fs.openSync(filename,"r");
  const read=reader(input,stat.size);check(read.take(MAGIC.length).equals(MAGIC));
  const header=p.decode(read.frame());
  check(header&&Object.keys(header).length===5&&header.schema===1&&header.kind==="thread-encrypted-backup"&&/^[a-f0-9]{32}$/.test(header.id));
  check(header.vaultId===expected.vaultId&&header.genesisFingerprint===expected.genesisFingerprint,"BACKUP_SCOPE_MISMATCH");
  key=archiveKey(code,header);
  // Validate the first encrypted frame before creating any output.
  let count=0,value=decrypt(key,header,0,read.frame()),lastBucket=-1,lastId="";
  fs.mkdirSync(tempDirectory,{mode:0o700});owned=true;
  db=new EncryptedStore({filename:temp,key:localKey,scope:storeScope,create:true});
  db.transaction(store=>{
   while(value.kind==="record"){
    const bucket=BUCKETS.indexOf(value.bucket);
    check(Object.keys(value).length===4&&bucket>=0&&bucket>=lastBucket&&typeof value.id==="string"&&value.id.length>0&&value.id.length<=256&&count<MAX_RECORDS);
    check(bucket>lastBucket||Buffer.compare(Buffer.from(value.id),Buffer.from(lastId))>0);
    const id=createHash("sha256").update(p.encode([value.bucket,value.id])).digest("hex");
    // Original device IDs/counters/keys remain recovery data. Reusing them as
    // an active identity would risk replay and counter rollback.
    store.put("recovery","backup-record-"+id,{bucket:value.bucket,id:value.id,value:value.value});
    lastBucket=bucket;lastId=value.id;count++;
    value=decrypt(key,header,count,read.frame());
   }
   check(Object.keys(value).length===2&&value.kind==="complete"&&value.count===count&&read.ended());
   store.put("recovery","$imported-backup",{schema:1,status:"REVIEW_REQUIRED",source:header,count});
  });
  db.close();db=null;
  // Closing the only SQLite connection checkpoints WAL. Never publish a
  // database that would need a sidecar not included in the atomic link.
  check(!fs.existsSync(temp+"-wal")||fs.statSync(temp+"-wal").size===0,"BACKUP_CHECKPOINT_REQUIRED");
  fs.closeSync(input);input=undefined;
  publish(temp,destination);return {id:header.id,count,status:"REVIEW_REQUIRED"};
 }catch(error){
  if(error.message==="BACKUP_SCOPE_MISMATCH")throw error;
  throw Error(error.code==="EEXIST"?"BACKUP_TARGET_EXISTS":"BACKUP_RESTORE_FAILED");
 }finally{key?.fill(0);try{db?.close();}finally{if(input!==undefined)fs.closeSync(input);if(owned){removeOwned(temp);fs.rmdirSync(tempDirectory);}}}
}
module.exports={newBackupCode,exportBackup,restoreBackup};
