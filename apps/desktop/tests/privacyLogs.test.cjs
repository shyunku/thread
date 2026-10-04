const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
test("socket logging never serializes payloads and preserves callbacks, receiver and returns",()=>{
 const logs=[],module={exports:{}};
 const source=fs.readFileSync(path.join(__dirname,"../public/electron/modules/util.js"),"utf8");
 vm.runInNewContext(source,{module,process:{env:{},platform:"win32"},
  require:name=>name.includes("constants")?{SocketSilentTopics:[]}:{},
  console:{system:(...args)=>logs.push(args.join(" "))},setTimeout});
 let registered,sent;
 const socket={on(topic,callback){registered=callback;return this;},emit(...args){sent=args;return true;}};
 module.exports.registerSocketLogger(socket);
 const payload={title:"PRIVATE_TASK",token:"PRIVATE_TOKEN",toJSON(){throw Error("PAYLOAD_MUST_NOT_BE_READ");}};
 let received;
 assert.equal(socket.on("PRIVATE_TOPIC",function(...args){assert.equal(this,socket);received=args;return 7;}),socket);
 assert.equal(registered.call(socket,payload,"PRIVATE_EXTRA"),7);
 assert.equal(received[0],payload);assert.equal(received[1],"PRIVATE_EXTRA");
 assert.equal(socket.emit("PRIVATE_TOPIC",payload),true);assert.equal(sent[1],payload);
 assert.deepEqual(logs,["SOCKET_RECEIVED","SOCKET_SENT"]);
});
test("mobile 2.0 logs only through the secure-aware logger",()=>{
 const parser=require("@babel/parser"),root=path.join(__dirname,"../../mobile/src"),files=[];
 const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(/\.tsx?$/.test(entry.name)&&!entry.name.endsWith(".d.ts"))files.push(full);}};
 walk(root);assert.ok(files.length>0);
 for(const file of files){
  const name=path.relative(root,file).replace(/\\/g,"/");
  if(name==="core/log.ts")continue;
  const source=fs.readFileSync(file,"utf8");
  const ast=parser.parse(source,{sourceType:"module",plugins:["typescript","jsx"]});
  const visit=node=>{
   if(!node||typeof node!=="object")return;
   if(node.type==="CallExpression"&&node.callee?.type==="MemberExpression"&&node.callee.object?.name==="console")
    assert.fail(name+" calls console directly; use core/log");
   for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==="object")visit(value);
  };
  visit(ast);
 }
});
