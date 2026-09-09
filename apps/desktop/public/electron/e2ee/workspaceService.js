const path=require("node:path"),{createHash}=require("node:crypto");
const {LocalVault}=require("./localVault"),{createVaultController}=require("./vaultController");
class VaultWorkspaceService{
 constructor(dependencies){this.dependencies=dependencies;this.active=null;this.generation=0;this.busy=false;}
 inject(group){this.group=group;}
 runtime(){
  if(this.dependencies)return this.dependencies;
  const {app,safeStorage,systemPreferences,powerMonitor}=require("electron");
  return this.dependencies={enabled:!app.isPackaged,baseDirectory:path.join(require("../modules/filesystem").getUserDataPath(),"e2ee"),
   environment:"development",protector:require("../modules/keyProtection").createKeyProtection({app,safeStorage}),
   osAuth:require("./osAuth").createOSAuth({app,systemPreferences}),powerMonitor,
   getWindow:()=>this.group.windowService.mainWindow,getAccount:()=>this.group.userService.getCurrent(),
   notify:data=>{const w=this.group.windowService.mainWindow;if(w&&!w.isDestroyed())w.webContents.send("vault/status",null,{success:true,data});}};
 }
 reset(){
  this.generation++;const old=this.active;this.active=null;old?.unwatch?.();old?.controller.dispose();
 }
 context(){
  const d=this.runtime();if(!d.enabled)throw Error("VAULT_NOT_ENABLED");
  const uid=d.getAccount();if(typeof uid!=="string"||!uid)throw Error("AUTH_REQUIRED");
  if(this.active?.uid!==uid)this.reset();
  if(!this.active){
   const scope={environment:d.environment,accountId:uid,vaultId:createHash("sha256").update(JSON.stringify([d.environment,uid,"vault-v1"])).digest("hex")};
   const vault=new LocalVault({baseDirectory:d.baseDirectory,scope,protector:d.protector});
   const entry={uid,vault,unlocked:false,abort:new AbortController()};
   entry.controller=createVaultController({vault,osAuth:d.osAuth,getWindow:d.getWindow,powerMonitor:d.powerMonitor,
    clearRenderer:()=>{entry.unlocked=false;entry.abort.abort();this.generation++;d.notify?.({uid,phase:"LOCKED",generation:this.generation});}});
   this.active=entry;
   const window=d.getWindow(),closed=()=>{if(this.active===entry)this.reset();},rendererGone=()=>entry.controller.lock();
   window?.once?.("closed",closed);window?.webContents?.on?.("render-process-gone",rendererGone);
   entry.unwatch=()=>{window?.removeListener?.("closed",closed);window?.webContents?.removeListener?.("render-process-gone",rendererGone);};
  }
  return this.active;
 }
 async status(){
  if(!this.runtime().enabled)return {enabled:false};
  const entry=this.context(),generation=this.generation,osAvailable=await this.runtime().osAuth.availability();
  if(entry!==this.active||entry.uid!==this.runtime().getAccount()||generation!==this.generation)throw Error("VAULT_SESSION_CHANGED");
  const state=entry.vault.inspect();
  return {enabled:true,uid:entry.uid,...state,phase:entry.unlocked?"UNLOCKED":state.phase,osAvailable,generation:this.generation,serverEncrypted:false};
 }
 async create(password){
  if(this.busy)throw Error("VAULT_BUSY");
  const entry=this.context();if(entry.vault.inspect().phase!=="ABSENT")throw Error("VAULT_ALREADY_EXISTS");
  this.busy=true;
  try{await entry.vault.createWithPassword(password);if(this.active!==entry||entry.uid!==this.runtime().getAccount())throw Error("VAULT_SESSION_CHANGED");return await this.status();}
  finally{password=undefined;this.busy=false;}
 }
 async unlock(method,password){
  if(this.busy)throw Error("VAULT_BUSY");
  const entry=this.context();this.busy=true;
  try{await entry.controller.unlock(method,password);if(entry!==this.active||entry.uid!==this.runtime().getAccount()){entry.controller.lock();throw Error("VAULT_SESSION_CHANGED");}
   entry.unlocked=true;entry.abort=new AbortController();return await this.status();
  }finally{password=undefined;this.busy=false;}
 }
 lock(){this.context().controller.lock();}
 intakes(){
  return this.context().controller.use(store=>{
   const result=[];let after="";
   for(;;){const rows=store.entries("recovery",after,256);
    for(const row of rows)if(/^\$legacy-pending-[a-f0-9]{32}$/.test(row.id)&&row.value.phase==="REVIEW_REQUIRED")result.push({id:row.id.slice(16),count:row.value.count});
    if(rows.length<256)return result;after=rows.at(-1).id;
   }
  });
 }
 reviews(request){return this.context().controller.legacyReviews(request);}
 registrationEndpoint(){
  const raw=this.runtime().endpoint||require("../modules/util").getServerFinalEndpoint().replace(/\/v[0-9]+\/?$/,"");
  const url=new URL(raw);
  if(url.username||url.password||url.search||url.hash)throw Error("INVALID_SERVER_ENDPOINT");
  return url.href;
 }
 async registerIdentity(){
  if(this.busy)throw Error("VAULT_BUSY");
  const entry=this.context();entry.controller.use(()=>{});this.busy=true;
  try{
   const transport=this.runtime().transport||require("./transport").createTransport({endpoint:this.registrationEndpoint(),token:async()=>{
    if(entry!==this.active||entry.uid!==this.runtime().getAccount()||entry.abort.signal.aborted)throw Error("AUTH_REQUIRED");
    const db=await this.group.databaseService.getRootDatabaseContext();
    // Do not use the legacy SQL logger for authentication metadata.
    const row=await new Promise((resolve,reject)=>db.db.get("SELECT access_token FROM users WHERE uid = ?",[entry.uid],(error,value)=>error?reject(error):resolve(value)));
    if(entry!==this.active||entry.uid!==this.runtime().getAccount()||entry.abort.signal.aborted)throw Error("AUTH_REQUIRED");
    return row?.access_token;
   }});
   return await entry.controller.use(store=>require("./ownerRegistration").registerOwner({store,transport,signal:entry.abort.signal}));
  }finally{this.busy=false;}
 }
 async prepareIdentity(){
  if(this.busy)throw Error("VAULT_BUSY");this.busy=true;
  try{return await this.context().controller.use(store=>require("./ownerIdentity").prepareOwner(store));}
  finally{this.busy=false;}
 }
 identityStatus(){return this.context().controller.use(store=>require("./ownerIdentity").ownerStatus(store));}
 recoveryCode(){return this.context().controller.use(store=>require("./ownerIdentity").recoveryMaterial(store).code);}
 async exportRecovery(){
  const entry=this.context(),generation=this.generation;
  const material=entry.controller.use(store=>require("./ownerIdentity").recoveryMaterial(store));
  const dialog=this.runtime().dialog||require("electron").dialog,fs=require("node:fs");
  const result=await dialog.showSaveDialog(this.runtime().getWindow(),{title:"암호화 복구 파일 저장",defaultPath:"Thread.thread-recovery",filters:[{name:"Thread recovery",extensions:["thread-recovery"]}]});
  if(result.canceled)return false;
  entry.controller.use(()=>{});
  if(this.active!==entry||generation!==this.generation)throw Error("VAULT_SESSION_CHANGED");
  const fd=fs.openSync(result.filePath,"wx",0o600);
  try{fs.writeFileSync(fd,material.bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return true;
 }
 async confirmRecovery(code){
  const entry=this.context(),generation=this.generation;entry.controller.use(()=>{});
  const dialog=this.runtime().dialog||require("electron").dialog,fs=require("node:fs");
  const result=await dialog.showOpenDialog(this.runtime().getWindow(),{title:"저장한 복구 파일 다시 열기",properties:["openFile"],filters:[{name:"Thread recovery",extensions:["thread-recovery"]}]});
  if(result.canceled)return false;
  if(this.active!==entry||generation!==this.generation)throw Error("VAULT_SESSION_CHANGED");
  const fd=fs.openSync(result.filePaths[0],"r");let bytes;
  try{
   const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>1024*1024)throw Error("INVALID_RECOVERY_FILE");
   const buffer=Buffer.alloc(1024*1024+1);let length=0,read;
   while(length<buffer.length&&(read=fs.readSync(fd,buffer,length,buffer.length-length,null))>0)length+=read;
   if(length>1024*1024)throw Error("INVALID_RECOVERY_FILE");bytes=buffer.subarray(0,length);
  }finally{fs.closeSync(fd);}
  return entry.controller.use(store=>require("./ownerIdentity").confirmOwnerRecovery(store,code,bytes));
 }
}
module.exports={VaultWorkspaceService};
