// Synthetic fixture only. No real app profile, account, env, network or migration.
const {app,BrowserWindow,ipcMain,systemPreferences,safeStorage,powerMonitor}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {LocalVault}=require("../public/electron/e2ee/localVault");
const {createVaultController}=require("../public/electron/e2ee/vaultController");
const {createOSAuth}=require("../public/electron/e2ee/osAuth");
const {createKeyProtection}=require("../public/electron/modules/keyProtection");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"thread-lock-fixture-"));
app.setPath("userData",temp);app.setPath("sessionData",temp);
app.whenReady().then(async()=>{
 const vault=new LocalVault({baseDirectory:path.join(temp,"vaults"),
  scope:{environment:"development",accountId:"synthetic",vaultId:"lock-test"},
  protector:createKeyProtection({app,safeStorage})});
 await vault.createWithPassword("fixture password");
 // Test data only; production writes must use the authenticated coordinator.
 const initial=await vault.openWithPassword("fixture password");
 initial.put("visible","one",{title:"SYNTHETIC: 잠그면 이 문구가 사라져야 합니다"});initial.close();
 const window=new BrowserWindow({width:650,height:460,title:"Thread vault lock test",
  webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,
   preload:path.join(__dirname,"vaultLock.manual.preload.cjs")}});
 const controller=createVaultController({vault,osAuth:createOSAuth({app,systemPreferences}),
  getWindow:()=>window,powerMonitor,clearRenderer:()=>{
   if(!window.isDestroyed())window.webContents.send("fixture/locked");
  }});
 window.on("closed",()=>controller.dispose());
 ipcMain.handle("fixture/vault",async(event,action,password)=>{
  if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)return {error:"DENIED"};
  try {
   if(action==="os"||action==="password")await controller.unlock(action,password);
   else if(action==="lock"){controller.lock();return {locked:true};}
   else if(action!=="read")return {error:"DENIED"};
   return {title:controller.use(db=>db.get("visible","one")).title};
  } catch {return {error:"LOCKED_OR_AUTH_FAILED"};}
 });
 await window.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(`<!doctype html><meta charset="utf-8">
 <style>body{font:16px system-ui;padding:24px;background:#15181e;color:#edf1f7}button,input{margin:5px;padding:8px}</style>
 <h2>테스트 보관함 잠금</h2><p>실제 계정/DB와 무관합니다. 테스트 비밀번호: fixture password</p>
 <button data-action="os">OS 인증</button><input id="password" type="password" autocomplete="off" placeholder="테스트 비밀번호">
 <button data-action="password">비밀번호로 열기</button><button data-action="lock">잠금</button>
 <button data-action="read">DB 읽기 확인</button><p id="status">LOCKED</p><p id="secret"></p>
 <script>
 let epoch=0;const status=document.querySelector('#status'),secret=document.querySelector('#secret');
 window.vaultFixture.onLocked(()=>{epoch++;secret.textContent='';status.textContent='LOCKED';});
 document.querySelectorAll('button').forEach(button=>button.onclick=async()=>{
  const generation=epoch;const input=document.querySelector('#password');let password=input.value;input.value='';
  button.disabled=true;
  try{const pending=window.vaultFixture.act(button.dataset.action,password);password='';const result=await pending;
   if(generation!==epoch)return;
   secret.textContent=result.title||'';status.textContent=result.title?'UNLOCKED':result.error||'LOCKED';
  }catch{secret.textContent='';status.textContent='FAILED';}finally{button.disabled=false;}
 });
 </script>`));
}).catch(()=>{console.error("SYNTHETIC_FIXTURE_START_FAILED");app.exit(1);});
app.on("window-all-closed",()=>app.quit());
