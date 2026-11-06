require("../public/electron/modules/secureLogs").initialize();
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict");
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"thread-vault-visual-"));app.setPath("userData",profile);app.setPath("sessionData",profile);
const output=process.env.THREAD_VISUAL_OUTPUT?path.resolve(process.env.THREAD_VISUAL_OUTPUT):path.resolve(__dirname,"../../../.tmp/vault-visual");
const timeout=setTimeout(()=>app.exit(1),90000);app.on("window-all-closed",()=>{});
// New account setup (#75): each step is reached by clicking through the synthetic flow.
const lock=["시작하기"],file=[...lock,"Windows Hello로 설정"],saved=[...file,"파일 저장"],code=[...saved,"다음"],copied=[...code,"@복구 코드 복사"],confirm=[...copied,"적어 뒀어요"],finish=[...confirm,"#SYNTHETIC-CODE","확인"];
const stages=[
 ["start","setup",[],/새 데이터 보호 설정[\s\S]*잠금 방법[\s\S]*복구 코드 확인[\s\S]*다른 계정으로 로그인/],
 ["lock","setup",lock,/1\/5 · 잠금 방법[\s\S]*Windows Hello로 설정/],
 ["lock-password","setup",[...lock,"^Windows Hello + 비밀번호"],/비밀번호 확인/],
 ["file","setup",file,/2\/5 · 복구 파일[\s\S]*파일 저장/],
 ["file-back","setup",[...file,"이전"],/잠금 방법\s*\(끝남\)[\s\S]*복구 파일[\s\S]*이어서 하기/],
 ["file-saved","setup",saved,/복구 파일을 저장했어요[\s\S]*다른 곳에 또 저장/],
 ["code","setup",code,/3\/5 · 복구 코드[\s\S]*THREAD1-F52B8\*/],
 ["code-copied","setup",copied,/복사됨/],
 ["confirm","setup",confirm,/4\/5 · 복구 코드 확인/],
 ["finish","setup",finish,/5\/5 · 시작[\s\S]*공개 연결 정보[\s\S]*시작하기/],
 ["start-error","start-error",[...finish,"시작하기"],/새 데이터 저장소를 시작하지 못했어요/],
 ["resume","resume",["이어서 하기"],/준비 끝/],
 ["unlock","unlock",[],/Windows Hello/],
 ["connect","connect",[],/이 기기에서 데이터 열기/],
 // Settings > data with an unlocked vault (the pre-#75 "보관함 열기" step no longer exists).
 ["settings","settings",[],/데이터[\s\S]*복구 키[\s\S]*백업과 복구/,[[1000,800]]],
];
const sizes=[[528,820],[360,500]];
async function step(w,action){
 const script=action.startsWith("#")?`(()=>{const i=document.querySelector('#gate-new-account-code');i.value=${JSON.stringify(action.slice(1))};return !!i;})()`:
  action.startsWith("@")?`(()=>{const b=document.querySelector('button[aria-label=${JSON.stringify(action.slice(1))}]');b?.click();return !!b;})()`:
  action.startsWith("^")?`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.startsWith(${JSON.stringify(action.slice(1))}));b?.click();return !!b;})()`:
  `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(action)}&&!e.disabled);b?.click();return !!b;})()`;
 assert.ok(await w.webContents.executeJavaScript(script),"missing control: "+action);
 await new Promise(resolve=>setTimeout(resolve,150));
}
app.whenReady().then(async()=>{
 let count=0;
 for(const [name,stage,actions,expected,only] of stages)for(const [width,height] of only||sizes){
  const w=new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true,sandbox:true}});
  await w.loadFile(path.join(output,"index.html"),{query:{stage}});
  await new Promise(resolve=>setTimeout(resolve,350));
  for(const action of actions)await step(w,action);
  const content=await w.webContents.executeJavaScript("({text:document.body.innerText,errors:window.fixtureErrors})");
  assert.ok(content.text.length>20,name+" missing UI: "+JSON.stringify(content.errors));
  assert.match(content.text,expected,name);
  // The full recovery code never reaches the page: only main's masked preview.
  assert.doesNotMatch(content.text,/THREAD1-F52B8[0-9A-F]{3}-[0-9A-Z]{8}/,name);
  if(name==="confirm")assert.doesNotMatch(content.text,/THREAD1-F52B8\*/);
  if(name==="lock-password"||name==="confirm"){
   const outline=await w.webContents.executeJavaScript("(()=>{const input=document.querySelector('.gate-step input');input.focus();return getComputedStyle(input).outlineStyle;})()");
   assert.equal(outline,"none",name+" focused input outline");
  }
  const layout=await w.webContents.executeJavaScript("({viewport:innerWidth,root:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('.application-gate__card,.gate-step__body,.gate-start,.data-settings')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({name:e.className,scroll:e.scrollWidth,client:e.clientWidth}))})");
  fs.writeFileSync(path.join(output,name+"-"+width+".png"),(await w.webContents.capturePage()).toPNG());
  assert.equal(layout.root>layout.viewport||layout.overflow.length>0,false,name+" horizontal overflow: "+JSON.stringify(layout));w.destroy();count++;
 }
 clearTimeout(timeout);process.stdout.write(`PASS: ${count} offscreen gate layouts, no horizontal overflow\n`);app.quit();
}).catch(error=>{process.stderr.write("Synthetic visual check failed: "+error.message+"\n");app.exit(1);});
