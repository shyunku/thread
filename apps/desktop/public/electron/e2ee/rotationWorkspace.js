const fs=require("node:fs"),rotation=require("./rotationCoordinator");
// Approximate connection time: a signed add record carries the pairing request's
// expiry (request time + 10 minutes). Genesis and recovered/rotated devices have no
// signed time, so their date is null and the UI omits it.
function connectedDevices(history,ownId){
 const added=new Map();
 for(const record of history.records.values()){
  const body=record?.body;
  if(body?.operation==="add"&&typeof body.device?.id==="string"&&Number.isSafeInteger(body.expiresAt))added.set(body.device.id,body.expiresAt-600000);
 }
 return [...history.current.devices.values()].map(value=>({id:value.id,role:value.role,own:value.id===ownId,addedAt:added.get(value.id)??null}));
}
async function execute(service,action,input={}){
 if(!["status","devices","prepare","code","export","confirm","commit","cancel"].includes(action))throw Error("INVALID_ROTATION_ACTION");
 if(service.busy)throw Error("VAULT_BUSY");
 const entry=service.context(),generation=service.generation,store=entry.controller.use(value=>value);
 const ready=()=>{if(service.active!==entry||service.generation!==generation||entry.abort.signal.aborted)throw Error("VAULT_SESSION_CHANGED");entry.controller.use(()=>{});};
 const base=service.transportFor(entry),transport={membership:after=>base.membership(after,entry.abort.signal),accountStatus:()=>base.accountStatus(entry.abort.signal),transition:record=>base.transition(record,entry.abort.signal)};
 service.busy=true;
 try{
  if(["prepare","commit"].includes(action)){
   if(input.confirmed!==true)throw Error("ROTATION_CONSENT_REQUIRED");
   if(input.method==="os"){if(!await service.runtime().osAuth.verify(service.runtime().getWindow()))throw Error("AUTH_CANCELLED");}
   else if(input.method==="password"){const opened=await entry.vault.openWithPassword(input.password);opened.close();}
   else throw Error("AUTH_REQUIRED");
   ready();
  }
  if(action==="status")return rotation.status(store);
  if(action==="devices"){
   const owner=store.get("recovery","$owner-identity");if(owner?.phase!=="RECOVERY_CONFIRMED")throw Error("ACTIVE_OWNER_REQUIRED");
   const history=await require("./filePairing").historyFor(store,transport,owner.fingerprint);ready();
   return connectedDevices(history,owner.deviceId);
  }
  if(action==="prepare")return await rotation.prepare({store,transport,remove:input.remove||[],ready});
  if(action==="code")return rotation.material(store).code;
  if(action==="cancel")return rotation.cancel(store);
  if(action==="commit"){
   // An unknown transition response must not let the ordinary sync loop
   // replace identity state before this coordinator reconciles the receipt.
   entry.sync?.close();entry.sync=null;entry.connected=false;
   return await rotation.commit({store,transport,ready});
  }
  const dialog=service.runtime().dialog||require("electron").dialog;
  if(action==="export"){
   const material=rotation.material(store);
   const result=await dialog.showSaveDialog(service.runtime().getWindow(),{defaultPath:"Thread-rotated.trec",filters:[{name:"Thread recovery",extensions:["trec"]}]});ready();
   if(result.canceled)return false;
   const fd=fs.openSync(result.filePath,"wx",0o600);
   try{fs.writeFileSync(fd,material.bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return true;
  }
  const result=await dialog.showOpenDialog(service.runtime().getWindow(),{properties:["openFile"],filters:[{name:"Thread recovery",extensions:["trec"]}]});ready();
  if(result.canceled)return null;
  require("./recoveryFile").requireTrec(result.filePaths[0]);
  const fd=fs.openSync(result.filePaths[0],"r");let bytes;
  try{
   const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>1024*1024)throw Error("INVALID_RECOVERY_FILE");
   bytes=Buffer.alloc(1024*1024+1);let length=0,n;
   while(length<bytes.length&&(n=fs.readSync(fd,bytes,length,bytes.length-length,null))>0)length+=n;
   if(length>1024*1024)throw Error("INVALID_RECOVERY_FILE");bytes=bytes.subarray(0,length);
  }finally{fs.closeSync(fd);}
  return await rotation.confirm({store,code:input.code,bytes,ready});
 }finally{input.password=undefined;input.code=undefined;service.busy=false;}
}
module.exports={execute,connectedDevices};
