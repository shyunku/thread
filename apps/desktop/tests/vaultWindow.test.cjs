const test=require("node:test"),assert=require("node:assert/strict"),{setVaultWindow}=require("../public/electron/modules/vaultWindow");
test("setup fits a small display and restores original app bounds on exit",()=>{
 let bounds={x:10,y:20,width:1200,height:900},min=[800,600],resize=true,max=true;
 const w={isDestroyed:()=>false,getNormalBounds:()=>({...bounds}),getMinimumSize:()=>[...min],isResizable:()=>resize,isMaximized:()=>max,unmaximize:()=>{max=false;},maximize:()=>{max=true;},setMinimumSize:(...v)=>{min=v;},setResizable:v=>{resize=v;},setBounds:v=>{bounds=v;}};
 setVaultWindow(w,"setup",{x:0,y:0,width:500,height:700});
 assert.equal(bounds.width,500);assert.equal(bounds.height,700);assert.equal(resize,false);
 setVaultWindow(w,"setup",{x:0,y:0,width:500,height:700});setVaultWindow(w,"app",{});
 assert.deepEqual(bounds,{x:10,y:20,width:1200,height:900});assert.deepEqual(min,[800,600]);assert.equal(max,true);assert.equal(resize,true);
 setVaultWindow(w,"setup",{x:0,y:0,width:1200,height:900});
 assert.equal(bounds.width,528);
 setVaultWindow(w,"app",{});
 assert.throws(()=>setVaultWindow(w,"arbitrary",{}));
});
