// Imported before application modules; protects renderer DevTools output.
if(window.thread?.secureLogs){
 const noop=()=>{};
 for(const name of ["log","debug","info","warn","error","system","trace","dir","table","assert","group","groupCollapsed","groupEnd","time","timeEnd","timeLog"])
  Object.defineProperty(console,name,{configurable:true,enumerable:true,get:()=>noop,set:()=>{}});
}
