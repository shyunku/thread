// Synthetic, offline update dialog preview. Never loads user data or app logs.
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module");
const {JSDOM}=require("jsdom"),babel=require("@babel/core"),React=require("react");
const root=path.resolve(__dirname,".."),components=path.join(root,"src","components");
const output=process.argv[2];if(!output)throw Error("OUTPUT_DIRECTORY_REQUIRED");
fs.mkdirSync(output,{recursive:true});
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://fixture.invalid"});
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;
global.HTMLElement=dom.window.HTMLElement;global.MutationObserver=dom.window.MutationObserver;
require.extensions[".scss"]=()=>{};
const originalJS=require.extensions[".js"];
require.extensions[".js"]=(module,filename)=>{
 if(!filename.startsWith(components+path.sep))return originalJS(module,filename);
 const source=fs.readFileSync(filename,"utf8"),result=babel.transformSync(source,{filename,babelrc:false,configFile:false,presets:["@babel/preset-env",["@babel/preset-react",{runtime:"automatic"}]]});
 module._compile(result.code,filename);
};
let state={version:"2.0.0",mandatory:true,status:"ready"},listener;
const ipc={onAll:(_topic,receive)=>{listener=receive;return receive;},off:()=>{},releaseAlerts:{get:receive=>receive({success:true,data:state}),install:()=>{},download:()=>{}}};
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
 if(request==="utils/IpcSender"&&parent?.filename.startsWith(components))return {__esModule:true,default:ipc};
 return originalLoad.call(this,request,parent,isMain);
};
const ReleaseAlert=require("../src/components/ReleaseAlert").default;
const {render,act}=require("@testing-library/react");
const view=render(React.createElement(ReleaseAlert));
const cssDir=path.join(root,"build","static","css"),css=fs.readFileSync(path.join(cssDir,fs.readdirSync(cssDir).find(name=>name.endsWith(".css"))),"utf8");
for(const status of ["ready","available","failed"]){
 state={...state,status};act(()=>listener({success:true,data:state}));
 const markup=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>html,body,#root{margin:0;width:100%;height:100%;background:#101216}</style></head><body><div id="root">${view.container.innerHTML}</div></body></html>`;
 fs.writeFileSync(path.join(output,status+".html"),markup,{flag:"wx"});
}
view.unmount();dom.window.close();process.stdout.write(output);
