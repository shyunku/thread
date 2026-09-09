const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const secret="SYNTHETIC_PRIVATE_TITLE_TOKEN_PASSWORD";
function logger(logs){return {info:(...a)=>logs.push(a),error:(...a)=>logs.push(a),system:(...a)=>logs.push(a),RGB:()=>"",wrap:v=>v,shorten:JSON.stringify};}
test("HTTP logging omits URLs, bodies, headers and raw errors without changing results",async()=>{
 const logs=[],response={title:secret},failure=Object.assign(Error(secret),{response:{status:409,data:secret}});
 let fail=false;const axios={post:async()=>{if(fail)throw failure;return {status:200,data:response};},get:async()=>({status:200,data:response})};
 const context={module:{exports:{}},console:logger(logs),require:()=>({default:{create:()=>axios}})};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../public/electron/core/request.js"),"utf8"),context);
 const request=context.module.exports;
 assert.equal(await request.post("https://"+secret,"/"+secret,{secret},{headers:{secret}}),response);
 assert.equal(await request.get("https://"+secret,"/?token="+secret),response);
 fail=true;await assert.rejects(request.post("https://fixture","/",{}),e=>e===failure);
 assert.equal(JSON.stringify(logs).includes(secret),false);assert.ok(JSON.stringify(logs).includes("409"));
});
test("IPC main logs omit request, response and exception payloads",async()=>{
 const logs=[],callbacks=new Map();
 class Router{broadcast(){return 1;}}
 const context={module:{exports:{}},console:logger(logs),require:name=>{
  if(name==="electron")return {ipcMain:{on:(topic,fn)=>callbacks.set(topic,fn)}};
  if(name.endsWith("util"))return {reqIdTag:()=>"fixture"};
  if(name.endsWith("IpcRouter"))return Router;
  if(name.endsWith("request"))return {ok:200};
  if(name.endsWith("windowSecurity"))return {isTrustedEvent:()=>true,canRequest:()=>true};
  throw Error(name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../public/electron/service/ipc.service.js"),"utf8"),context);
 const service=new context.module.exports();service.windowService={trustedWindows:new Map([[1,"main"]])};
 service.register("fixture/action",()=>{throw Error(secret)});
 await callbacks.get("fixture/action")({sender:{id:1}},"req",{title:secret});
 service.sender("fixture/action","req",true,{title:secret});
 service.emiter("fixture/action","req",{title:secret});
 service.fastSender("fixture/action",{code:200,data:secret});
 assert.equal(JSON.stringify(logs).includes(secret),false);
});
