const methods=["log","debug","info","warn","error","system","trace","dir","table","assert","group","groupCollapsed","groupEnd","time","timeEnd","timeLog"];
function enabled(argv=process.argv,env=process.env){return argv.includes("--secure-logs")||env.THREAD_SECURE_LOGS==="1";}
function silence(target){
 const noop=()=>{};
 for(const name of methods)Object.defineProperty(target,name,{configurable:true,enumerable:true,get:()=>noop,set:()=>{}});
}
function initialize(){
 if(!enabled())return false;
 process.env.THREAD_SECURE_LOGS="1";
 silence(console);
 const logger=require("electron-log/main");
 for(const transport of Object.values(logger.transports))transport.level=false;
 return true;
}
module.exports={enabled,silence,initialize};
