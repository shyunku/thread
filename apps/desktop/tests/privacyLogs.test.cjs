const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
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
