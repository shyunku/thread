// User-driven native authentication test; no vault, account, env file, or app DB.
const {app,BrowserWindow,ipcMain,systemPreferences}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createOSAuth}=require("../public/electron/e2ee/osAuth");
if(!app)throw Error("Run as Electron without ELECTRON_RUN_AS_NODE");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"thread-auth-fixture-"));
app.setPath("userData",temp);app.setPath("sessionData",temp);
app.whenReady().then(async()=>{
 const window=new BrowserWindow({width:520,height:320,title:"Thread OS authentication test",
  webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,"osAuth.manual.preload.cjs")}});
 const provider=createOSAuth({app,systemPreferences});
 ipcMain.handle("fixture/verify",async event=>{
  if(event.sender!==window.webContents||event.senderFrame!==event.sender.mainFrame)return "DENIED";
  try {return await provider.verify(window)?"VERIFIED":"DENIED";}
  catch(error){return error.message;}
 });
 await window.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(`<!doctype html><meta charset="utf-8">
 <style>body{font:16px system-ui;background:#15181e;color:#edf1f7;padding:24px}button{padding:12px}</style>
 <h2>OS 인증 테스트</h2><p>실제 보관함이나 계정 데이터는 열지 않습니다.</p>
 <button id="verify">Windows Hello / Touch ID 테스트</button><p id="result">버튼을 누르고 성공, 취소를 각각 확인해주세요.</p>
 <script>document.querySelector('#verify').onclick=async()=>{const b=document.querySelector('#verify');b.disabled=true;try{document.querySelector('#result').textContent=await window.authFixture.verify();}finally{b.disabled=false;}};</script>`));
});
app.on("window-all-closed",()=>app.quit());
