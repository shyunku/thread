// Synthetic, offline UI preview. Never loads application data or Electron logs.
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module");
const React=require("react"),{renderToStaticMarkup}=require("react-dom/server"),babel=require("@babel/core");
const {VscChromeClose,VscChromeMinimize}=require("react-icons/vsc");
const root=path.resolve(__dirname,".."),components=path.join(root,"src","components");
const originalJS=require.extensions[".js"];
require.extensions[".scss"]=()=>{};
require.extensions[".js"]=(module,filename)=>{
 if(!filename.startsWith(components+path.sep))return originalJS(module,filename);
 const source=fs.readFileSync(filename,"utf8");
 const result=babel.transformSync(source,{filename,babelrc:false,configFile:false,presets:["@babel/preset-env",["@babel/preset-react",{runtime:"automatic"}]]});
 module._compile(result.code,filename);
};
const VaultUnlock=require("../src/components/VaultUnlock").default;
const css=fs.readFileSync(path.join(root,"build","static","css",fs.readdirSync(path.join(root,"build","static","css")).find(name=>name.endsWith(".css"))),"utf8");
const output=process.argv[2];if(!output)throw Error("OUTPUT_DIRECTORY_REQUIRED");fs.mkdirSync(output,{recursive:true});
function page(osAvailable){
 const e=React.createElement;
 const markup=e("main",{className:"application-gate"},
  e("div",{className:"application-gate__titlebar"},e("span",null,"Thread"),e("div",{className:"application-gate__window-actions"},e("button",{"aria-label":"최소화"},e(VscChromeMinimize)),e("button",{"aria-label":"닫기"},e(VscChromeClose)))),
  e("div",{className:"application-gate__card"},e("header",{className:"application-gate__header"},e("div",{className:"application-gate__heading"},e("h1",null,"데이터 보호 업데이트"))),
   e("section",{className:"vault-workspace"},e("ol",{className:"vault-progress"},e("li",{className:"vault-progress__reached"},"1. 본인 확인"),e("li",null,"2. 백업 수단 저장"),e("li",null,"3. 데이터 이동")),e(VaultUnlock,{setup:true,osAvailable,preparationOnly:true}))));
 return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>html,body,#root{margin:0;width:100%;height:100%}</style></head><body><div id="root">${renderToStaticMarkup(markup)}</div></body></html>`;
}
for(const [name,available] of [["methods",true],["password",false]])fs.writeFileSync(path.join(output,name+".html"),page(available),{flag:"wx"});
async function recoveryPage(){
 const {JSDOM}=require("jsdom"),dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://fixture.invalid"});
 global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;global.HTMLElement=dom.window.HTMLElement;global.MutationObserver=dom.window.MutationObserver;
 const ipc={vault:{identityStatus:cb=>cb({success:true,data:{phase:"RECOVERY_UNCONFIRMED"}}),exportRecovery:cb=>cb({success:true,data:true}),recoveryCodePreview:cb=>cb({success:true,data:"THREAD1-F52B8***-"+Array(8).fill("********").join("-")}),copyRecoveryCode:cb=>cb({success:true,data:true})}};
 const oldLoad=Module._load;Module._load=function(request,parent,isMain){if(request==="../utils/IpcSender"&&parent?.filename.startsWith(components))return {__esModule:true,default:ipc};if(request==="../molecules/Toast"&&parent?.filename.startsWith(components))return {__esModule:true,default:{success:()=>{}}};return oldLoad.call(this,request,parent,isMain);};
 const RecoverySetup=require("../src/components/RecoverySetup").default,{render,screen,fireEvent}=require("@testing-library/react");
 const view=render(React.createElement(RecoverySetup));
 fireEvent.click(await screen.findByText("복구 파일 저장"));
 await screen.findByText(/^THREAD1-F52B8\*/);
 const controls=renderToStaticMarkup(React.createElement("div",{className:"application-gate__window-actions"},React.createElement("button",{"aria-label":"최소화"},React.createElement(VscChromeMinimize)),React.createElement("button",{"aria-label":"닫기"},React.createElement(VscChromeClose))));
 const markup=`<main class="application-gate"><div class="application-gate__titlebar"><span>Thread</span>${controls}</div><div class="application-gate__card"><header class="application-gate__header"><div class="application-gate__heading"><h1>데이터 보호 업데이트</h1></div></header><section class="vault-workspace">${view.container.innerHTML}</section></div></main>`;
 fs.writeFileSync(path.join(output,"recovery.html"),`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>html,body,#root{margin:0;width:100%;height:100%}</style></head><body><div id="root">${markup}</div></body></html>`,{flag:"wx"});
 view.unmount();dom.window.close();
}
recoveryPage().then(()=>{process.stdout.write(output);}).catch(error=>{process.stderr.write(error.stack);process.exitCode=1;});
