require("../public/electron/modules/secureLogs").initialize();
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict");
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"thread-vault-visual-"));app.setPath("userData",profile);app.setPath("sessionData",profile);
const output=path.resolve(__dirname,"../../../.tmp/vault-visual");
const timeout=setTimeout(()=>app.exit(1),45000);app.on("window-all-closed",()=>{});
app.whenReady().then(async()=>{
 for(const [stage,width,height] of [["setup",620,820],["unlock",620,820],["recovery",620,820],["register",620,820],["settings",1000,800],["settings-recovery",1000,800],["setup",360,500]]){
  const w=new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true,sandbox:true}});
  await w.loadFile(path.join(output,"index.html"),{query:{stage:stage.startsWith("settings")?"settings":stage}});
  await new Promise(resolve=>setTimeout(resolve,350));
  const content=await w.webContents.executeJavaScript("({text:document.body.innerText,errors:window.fixtureErrors})");
  assert.ok(content.text.length>20,stage+" missing UI: "+JSON.stringify(content.errors));
  if(stage.startsWith("settings")){
   await w.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(e=>e.textContent==='보관함 열기').click()");
   await new Promise(resolve=>setTimeout(resolve,150));
   if(stage==="settings-recovery"){
    await w.webContents.executeJavaScript("[...document.querySelectorAll('.vault-menu button')].find(e=>e.textContent.startsWith('복구 자료')).click()");
    await new Promise(resolve=>setTimeout(resolve,150));
   }
   await w.webContents.executeJavaScript("document.querySelector('.data-settings__vault').scrollIntoView({block:'start'})");
  }
  const horizontal=await w.webContents.executeJavaScript("document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('.application-gate__card,.vault-workspace')].some(e=>e.scrollWidth>e.clientWidth+1)");
  assert.equal(horizontal,false,stage+" horizontal overflow");
  fs.writeFileSync(path.join(output,stage+"-"+width+".png"),(await w.webContents.capturePage()).toPNG());w.destroy();
 }
 clearTimeout(timeout);process.stdout.write("PASS: seven offscreen vault layouts, no horizontal overflow\n");app.quit();
}).catch(error=>{process.stderr.write("Synthetic visual check failed: "+error.message+"\n");app.exit(1);});
