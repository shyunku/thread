const fs=require("node:fs"),path=require("node:path"),{randomBytes}=require("node:crypto");
const backup=require("./dataBackup"),{EncryptedStore}=require("./localStore");
const PREFIX="$backup-review-";
function identity(store){
 const value=store.get("recovery","$paired-device")||store.get("recovery","$owner-identity");
 if(!value?.fingerprint)throw Error("IDENTITY_REQUIRED");
 return {vaultId:store.scope().vaultId,genesisFingerprint:value.fingerprint};
}
function target(service,id){
 if(typeof id!=="string"||!/^[a-f0-9]{32}$/.test(id))throw Error("INVALID_BACKUP_ID");
 return path.join(service.runtime().baseDirectory,"backup-reviews",id+".db");
}
function reviews(service,store,input){
 const marker=store.get("recovery",PREFIX+input.id);
 if(!marker)throw Error("BACKUP_NOT_FOUND");
 let db;
 try{
  db=new EncryptedStore({filename:target(service,input.id),key:marker.key,scope:store.scope()});
  const imported=db.get("recovery","$imported-backup");if(!imported||imported.status!=="REVIEW_REQUIRED")throw Error("BACKUP_INCOMPLETE");
  let after=input.after||"";if(typeof after!=="string"||after.length>256)throw Error("INVALID_BACKUP_CURSOR");
  const rows=db.entries("recovery",after,50),items=[];
  for(const row of rows){
   const record=row.value;
   if(!row.id.startsWith("backup-record-")||!["confirmed","visible"].includes(record.bucket)||record.id.startsWith("$"))continue;
   const canonical=record.value?.fields?.length===1&&record.value.fields[0].slot===0?record.value.fields[0].value:null;
   const fields=canonical?.fields;
   if(!fields||typeof fields!=="object")continue;
   // Never return identity, outbox signatures, key material, or arbitrary metadata.
   const content={};
   for(const name of ["title","memo"])if(typeof fields[name]==="string")content[name]=fields[name].slice(0,10000);
   items.push({id:row.id,bucket:record.bucket,content,deleted:record.value.deleted===true});
  }
  return {items,next:rows.length===50?rows.at(-1).id:null,count:imported.count};
 }finally{db?.close();marker.key.fill(0);}
}
async function execute(service,action,input={}){
 if(!["code","last","export","restore","list","review","apply"].includes(action))throw Error("INVALID_BACKUP_ACTION");
 if(service.busy)throw Error("VAULT_BUSY");
 const entry=service.context(),generation=service.generation,store=entry.controller.use(value=>value);
 const ready=()=>{if(service.active!==entry||service.generation!==generation||entry.abort.signal.aborted)throw Error("VAULT_SESSION_CHANGED");entry.controller.use(()=>{});};
 service.busy=true;
 try{
  if(action==="code")return backup.newBackupCode();
  if(action==="last")return store.get("recovery","$last-backup")||null;
  if(action==="list"){
   const result=[];let after="";
   for(;;){const rows=store.entries("recovery",after,256);for(const row of rows)if(row.id.startsWith(PREFIX))result.push({id:row.id.slice(PREFIX.length),phase:row.value.phase});if(rows.length<256)return result;after=rows.at(-1).id;}
  }
  if(action==="review")return reviews(service,store,input);
  if(input.confirmed!==true)throw Error("BACKUP_CONSENT_REQUIRED");
  if(input.method==="os"){if(!await service.runtime().osAuth.verify(service.runtime().getWindow()))throw Error("AUTH_CANCELLED");}
  else if(input.method==="password"){const opened=await entry.vault.openWithPassword(input.password);opened.close();}
  else throw Error("AUTH_REQUIRED");
  ready();const scope=identity(store),dialog=service.runtime().dialog||require("electron").dialog;
  if(action==="apply"){
   if(!entry.applicationActive)throw Error("E2EE_APPLICATION_REQUIRED");
   const marker=store.get("recovery",PREFIX+input.id),meta=store.get("confirmed","$sync-state");
   if(!marker||!meta)throw Error("BACKUP_NOT_READY");
   let source;
   try{
    source=new EncryptedStore({filename:target(service,input.id),key:marker.key,scope:store.scope()});
    const imported=source.get("recovery","$imported-backup");
    if(imported?.status!=="REVIEW_REQUIRED"||imported.source.vaultId!==scope.vaultId||imported.source.genesisFingerprint!==scope.genesisFingerprint)throw Error("BACKUP_SCOPE_MISMATCH");
    const replica=new (require("./replica").EncryptedReplica)(store,meta.scope,{initialize:false});
    return require("./backupCopies").restoreCopies(replica,source,input.id);
   }finally{source?.close();marker.key.fill(0);}
  }
  if(action==="export"){
   const result=await dialog.showSaveDialog(service.runtime().getWindow(),{defaultPath:"Thread.threadbackup",filters:[{name:"Encrypted Thread backup",extensions:["threadbackup"]}]});ready();
   if(result.canceled)return null;
   const resultData=await backup.exportBackup({store,scope,filename:result.filePath,code:input.code});ready();
   store.put("recovery","$last-backup",{at:Date.now(),count:resultData.count});
   return {phase:"EXPORTED",count:resultData.count};
  }
  const result=await dialog.showOpenDialog(service.runtime().getWindow(),{properties:["openFile"],filters:[{name:"Encrypted Thread backup",extensions:["threadbackup"]}]});ready();
  if(result.canceled)return null;
  const id=randomBytes(16).toString("hex"),key=randomBytes(32),destination=target(service,id);
  try{
   fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
   // Keep the wrapping key even if a lock arrives immediately after restore.
   // This record is encrypted by the active vault and is never sent to renderer.
   store.put("recovery",PREFIX+id,{phase:"STAGED",key});
   const imported=await backup.restoreBackup({filename:result.filePaths[0],destination,code:input.code,scope,localKey:key,storeScope:store.scope()});
   ready();store.put("recovery",PREFIX+id,{phase:"REVIEW_REQUIRED",key});
   return {phase:"REVIEW_REQUIRED",id,count:imported.count};
  }finally{key.fill(0);}
 }finally{input.password=undefined;input.code=undefined;service.busy=false;}
}
module.exports={execute,reviews};
