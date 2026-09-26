// Synthetic isolated Electron profile only; never starts the user's application.
require("../public/electron/modules/secureLogs").initialize();
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{EventEmitter}=require("node:events");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"thread-secure-log-smoke-"));
app.setPath("userData",temp);app.setPath("sessionData",temp);
const timeout=setTimeout(()=>app.exit(1),20000);
app.on("window-all-closed",()=>{});
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.resolve(__dirname,"../public/electron/modules/preload.js")}});
 await w.loadURL("data:text/html,<html><body>synthetic</body></html>");
 const {setVaultWindow}=require("../public/electron/modules/vaultWindow");
 const before=w.getBounds();
 setVaultWindow(w,"setup",{x:0,y:0,width:1200,height:900});
 assert.deepEqual([w.getBounds().width,w.getBounds().height],[528,820]);
 assert.equal(w.isResizable(),false);
 setVaultWindow(w,"app");assert.deepEqual(w.getBounds(),before);
 assert.equal(await w.webContents.executeJavaScript("window.thread.secureLogs"),true);
 const source=fs.readFileSync(path.resolve(__dirname,"../src/utils/secureLogs.js"),"utf8");
 assert.equal(await w.webContents.executeJavaScript("(()=>{let calls=0;console.log=()=>{calls++;};"+source+";console.log('SYNTHETIC_ONLY');return calls;})()"),0);
 const power=new EventEmitter();power.getSystemIdleTime=()=>0;
 const {VaultWorkspaceService}=require("../public/electron/e2ee/workspaceService");
 const service=new VaultWorkspaceService({enabled:true,baseDirectory:temp,environment:"development",getAccount:()=>"synthetic",getWindow:()=>w,powerMonitor:power});
 service.context();w.destroy();assert.equal(service.active,null);assert.equal(power.listenerCount("lock-screen"),0);
 clearTimeout(timeout);
 process.stdout.write("PASS: secure renderer flag, suppressed console, vault window bounds/restore, destroyed-window cleanup\n");
 app.quit();
}).catch(()=>{process.stderr.write("FAIL: secure logging Electron smoke\n");app.exit(1);});
app.on("will-quit",()=>{try{fs.rmSync(temp,{recursive:true,force:true});}catch{}});
