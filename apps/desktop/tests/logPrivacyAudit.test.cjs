const fs=require("node:fs"),path=require("node:path"),parser=require("@babel/parser"),assert=require("node:assert/strict"),test=require("node:test");
const root=path.resolve(__dirname,".."),allowed=new Set(["public/electron/modules/console.js","public/electron/core/request.js"]);
function audit(){
 const files=[];
 function scan(dir){
  for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
   const file=dir+"/"+entry.name;
   if(entry.isDirectory()){if(entry.name!=="resources")scan(file);continue;}
   if(!entry.name.endsWith(".js")||entry.name.endsWith(".test.js")||allowed.has(file))continue;
   const source=fs.readFileSync(path.join(root,file),"utf8").replace(/\r\n/g,"\n"),edits=[];
   function visit(node){
    if(!node||typeof node!=="object")return;
    if(node.type==="CallExpression"&&node.callee.type==="MemberExpression"&&node.callee.object.name==="console"&&
     ["log","debug","info","warn","error","system"].includes(node.callee.property.name)&&
     node.arguments.some(arg=>arg.type!=="StringLiteral"&&(arg.type!=="TemplateLiteral"||arg.expressions.length))){
     const first=node.arguments[0],label=first.type==="StringLiteral"?first.value:path.basename(file,".js").replace(/[^a-z0-9]/gi,"_").toUpperCase()+"_"+node.callee.property.name.toUpperCase();
     edits.push({start:node.start,end:node.end,text:"console."+node.callee.property.name+"("+JSON.stringify(label)+")"});
    }
    for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==="object")visit(value);}
   }
   visit(parser.parse(source,{sourceType:"unambiguous",plugins:["jsx"]}));
   if(edits.length){
    const groups=[];
    for(const edit of edits.sort((a,b)=>a.start-b.start)){
     const start=source.lastIndexOf("\n",edit.start)+1,endIndex=source.indexOf("\n",edit.end),end=endIndex<0?source.length:endIndex;
     const last=groups.at(-1);
     if(last&&start<=last.end){last.end=Math.max(last.end,end);last.edits.push(edit);}
     else groups.push({start,end,edits:[edit]});
    }
    files.push({file,changes:groups.map(group=>{
     const before=source.slice(group.start,group.end);let after=before;
     for(const edit of group.edits.sort((a,b)=>b.start-a.start))after=after.slice(0,edit.start-group.start)+edit.text+after.slice(edit.end-group.start);
     return {before,after};
    })});
   }
  }
 }
 scan("public/electron");scan("src");return files;
}
if(process.argv.includes("--patch"))process.stdout.write(JSON.stringify(audit()));
else test("desktop diagnostic calls do not accept dynamic payloads outside reviewed metadata sinks",()=>{
 const failures=audit();assert.deepEqual(failures.map(row=>row.file),[]);
});
