require("../public/electron/modules/secureLogs").initialize();
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict");
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"thread-vault-visual-"));app.setPath("userData",profile);app.setPath("sessionData",profile);
const output=process.env.THREAD_VISUAL_OUTPUT?path.resolve(process.env.THREAD_VISUAL_OUTPUT):path.resolve(__dirname,"../../../.tmp/vault-visual");
const timeout=setTimeout(()=>app.exit(1),45000);app.on("window-all-closed",()=>{});
app.whenReady().then(async()=>{
 for(const [stage,width,height] of [["setup",528,820],["password",528,820],["unlock",528,820],["recovery",528,820],["confirm",528,820],["register",528,820],["activate",528,820],["settings",1000,800],["settings-recovery",1000,800],["setup",360,500],["recovery",360,500],["confirm",360,500],["activate",360,500]]){
  const w=new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true,sandbox:true}});
  await w.loadFile(path.join(output,"index.html"),{query:{stage:stage.startsWith("settings")?"settings":stage}});
  await new Promise(resolve=>setTimeout(resolve,350));
  if(stage==="setup"||stage==="password"){
   await w.webContents.executeJavaScript(`([...document.querySelectorAll('button')].find(e=>e.textContent==='${stage==="setup"?"Windows Hello / Touch ID만":"비밀번호도 사용"}'))?.click()`);
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  if(stage==="activate"){
   await w.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(e=>e.textContent==='등록 확인')?.click()");
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  if(stage==="recovery"||stage==="confirm"){
   await w.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(e=>e.textContent==='복구 파일 저장')?.click()");
   await new Promise(resolve=>setTimeout(resolve,150));
   if(stage==="confirm"){
    await w.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==='복구 코드 복사')?.click()");
    await new Promise(resolve=>setTimeout(resolve,100));
    await w.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(e=>e.textContent==='저장했어요')?.click()");
    await new Promise(resolve=>setTimeout(resolve,100));
   }
  }
  const content=await w.webContents.executeJavaScript("({text:document.body.innerText,errors:window.fixtureErrors})");
  assert.ok(content.text.length>20,stage+" missing UI: "+JSON.stringify(content.errors));
  if(stage==="setup")assert.match(content.text,/OS 인증으로 설정/);
  if(stage==="password")assert.match(content.text,/비밀번호 확인/);
  if(stage==="recovery"){
   assert.match(content.text,/THREAD1-F52B8\*/);assert.doesNotMatch(content.text,/기록한 복구 코드/);
   const preview=await w.webContents.executeJavaScript("(()=>{const text=document.querySelector('.recovery-setup__code button span'),style=getComputedStyle(text);return {weight:style.fontWeight,overflow:style.textOverflow,whiteSpace:style.whiteSpace,scroll:text.scrollWidth,width:text.clientWidth};})()");
   assert.equal(preview.weight,"400");assert.equal(preview.overflow,"ellipsis");assert.equal(preview.whiteSpace,"nowrap");assert.ok(preview.scroll>preview.width,JSON.stringify(preview));
  }
  if(stage==="confirm"){assert.match(content.text,/복구 코드 확인/);assert.doesNotMatch(content.text,/THREAD1-F52B8\*/);}
  if(stage==="register")assert.match(content.text,/등록 확인/);
  if(stage==="activate"){assert.match(content.text,/암호화된 데이터 시작/);assert.match(content.text,/시작하기/);assert.doesNotMatch(content.text,/데이터 이동|데이터 보호 업데이트/);}
  if(stage==="password"||stage==="confirm"){
   const outline=await w.webContents.executeJavaScript("(()=>{const input=document.querySelector('.vault-workspace input');input.focus();return getComputedStyle(input).outlineStyle;})()");
   assert.equal(outline,"none",stage+" focused input outline");
  }
  if(stage.startsWith("settings")){
   await w.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(e=>e.textContent==='보관함 열기').click()");
   await new Promise(resolve=>setTimeout(resolve,150));
   if(stage==="settings-recovery"){
    await w.webContents.executeJavaScript("[...document.querySelectorAll('.vault-menu button')].find(e=>e.textContent.startsWith('복구 자료')).click()");
    await new Promise(resolve=>setTimeout(resolve,150));
   }
   await w.webContents.executeJavaScript("document.querySelector('.data-settings__vault').scrollIntoView({block:'start'})");
  }
  const layout=await w.webContents.executeJavaScript("({viewport:innerWidth,root:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('.application-gate__card,.vault-workspace')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({name:e.className,scroll:e.scrollWidth,client:e.clientWidth,children:[...e.querySelectorAll('button,input,form,section')].map(n=>({name:n.className||n.tagName,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right,marginRight:getComputedStyle(n).marginRight,scroll:n.scrollWidth,client:n.clientWidth})).filter(n=>n.right>e.getBoundingClientRect().right+1||n.scroll>n.client+1||parseFloat(n.marginRight)>0).slice(0,12)}))})");
  fs.writeFileSync(path.join(output,stage+"-"+width+".png"),(await w.webContents.capturePage()).toPNG());
  assert.equal(layout.root>layout.viewport||layout.overflow.length>0,false,stage+" horizontal overflow: "+JSON.stringify(layout));w.destroy();
 }
 clearTimeout(timeout);process.stdout.write("PASS: thirteen offscreen vault layouts, no horizontal overflow\n");app.quit();
}).catch(error=>{process.stderr.write("Synthetic visual check failed: "+error.message+"\n");app.exit(1);});
