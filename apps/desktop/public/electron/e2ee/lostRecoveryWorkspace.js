const fs=require("node:fs"),recovery=require("./lostRecovery");
function readRecovery(filename){
 const fd=fs.openSync(filename,"r");let bytes;
 try{
  const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>1024*1024)throw Error("INVALID_RECOVERY_FILE");
  bytes=Buffer.alloc(stat.size+1);let length=0,n;
  while(length<bytes.length&&(n=fs.readSync(fd,bytes,length,bytes.length-length,null))>0)length+=n;
  if(length!==stat.size)throw Error("RECOVERY_FILE_CHANGED");return bytes.subarray(0,length);
 }finally{fs.closeSync(fd);}
}
async function execute(service,action,input={}){
 if(!["status","prepare","code","export","confirm","commit","cancel"].includes(action))throw Error("INVALID_RECOVERY_ACTION");
 if(service.busy)throw Error("VAULT_BUSY");
 const entry=service.context(),generation=service.generation,store=entry.controller.use(value=>value);
 const ready=()=>{if(service.active!==entry||service.generation!==generation||entry.abort.signal.aborted)throw Error("VAULT_SESSION_CHANGED");entry.controller.use(()=>{});};
 const base=service.transportFor(entry),transport={membership:after=>base.membership(after,entry.abort.signal),accountStatus:()=>base.accountStatus(entry.abort.signal),transition:record=>base.transition(record,entry.abort.signal),recoverPending:record=>base.recoverPending(record,entry.abort.signal)};
 service.busy=true;
 try{
  if(action==="status")return recovery.status(store);
  if(["prepare","commit"].includes(action)){
   if(input.confirmed!==true)throw Error("RECOVERY_CONSENT_REQUIRED");
   if(input.method==="os"){if(!await service.runtime().osAuth.verify(service.runtime().getWindow()))throw Error("AUTH_CANCELLED");}
   else if(input.method==="password"){const opened=await entry.vault.openWithPassword(input.password);opened.close();}
   else throw Error("AUTH_REQUIRED");
   ready();
  }
  if(action==="code")return recovery.material(store).code;
  if(action==="cancel")return recovery.cancel(store);
  if(action==="commit")return await recovery.commit({store,transport,ready});
  const dialog=service.runtime().dialog||require("electron").dialog;
  if(action==="export"){
   const result=await dialog.showSaveDialog(service.runtime().getWindow(),{defaultPath:"Thread-restored.thread-recovery",filters:[{name:"Thread recovery",extensions:["thread-recovery"]}]});ready();
   if(result.canceled)return null;
   const material=recovery.material(store),fd=fs.openSync(result.filePath,"wx",0o600);
   try{fs.writeFileSync(fd,material.bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return true;
  }
  const result=await dialog.showOpenDialog(service.runtime().getWindow(),{properties:["openFile"],filters:[{name:"Thread recovery",extensions:["thread-recovery"]}]});ready();
  if(result.canceled)return null;
  const bytes=readRecovery(result.filePaths[0]);
  return await recovery[action]({store,transport,code:input.code,bytes,ready});
 }finally{input.password=undefined;input.code=undefined;service.busy=false;}
}
module.exports={execute};
