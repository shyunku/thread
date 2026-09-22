const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict"),test=require("node:test");
const {silence,enabled}=require("../public/electron/modules/secureLogs");
const root=path.resolve(__dirname,"..");
test("secure mode is explicit and suppresses every console sink even after reassignment",()=>{
 assert.equal(enabled([],{}),false);assert.equal(enabled(["--secure-logs"],{}),true);assert.equal(enabled([],{THREAD_SECURE_LOGS:"1"}),true);
 const logs=[],target={log:(...args)=>logs.push(args)};
 target.log("normal details");assert.equal(logs.length,1);silence(target);
 for(const name of ["log","info","error","warn","debug","system","trace","table","dir","assert"]){target[name]=(...args)=>logs.push(args);target[name]("PRIVATE_SENTINEL");}
 assert.equal(logs.length,1);
});
test("secure startup disables file transports and propagates renderer flag before application imports",()=>{
 const env={},transports={file:{level:"debug"},console:{level:"debug"}},module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(root,"public/electron/modules/secureLogs.js"),"utf8"),{module,process:{argv:["--secure-logs"],env},console:{},require:()=>({transports})});
 assert.equal(module.exports.initialize(),true);assert.equal(env.THREAD_SECURE_LOGS,"1");
 assert.equal(transports.file.level,false);assert.equal(transports.console.level,false);
 const main=fs.readFileSync(path.join(root,"public/electron/core/main.js"),"utf8");
 assert.ok(main.indexOf('secureLogs')<main.indexOf('require("electron")'));
 const renderer=fs.readFileSync(path.join(root,"src/index.js"),"utf8");assert.ok(renderer.startsWith('import "./utils/secureLogs";'));
});
test("renderer secure mode suppresses output while normal mode preserves it",()=>{
 const source=fs.readFileSync(path.join(root,"src/utils/secureLogs.js"),"utf8");
 for(const secureLogs of [false,true]){
  const logs=[],console={log:value=>logs.push(value)};
  vm.runInNewContext(source,{window:{thread:{secureLogs}},console});console.log("PRIVATE_SENTINEL");
  assert.equal(logs.length,secureLogs?0:1);
 }
});
