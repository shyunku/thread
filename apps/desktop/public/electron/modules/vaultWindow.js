const previous=new WeakMap();
// Window sizes while the app is not in its normal workspace:
// "setup" for onboarding/migration flows, "lock" for the compact unlock screen.
const SIZES={setup:{width:528,height:820,minWidth:360,minHeight:420},lock:{width:380,height:500,minWidth:340,minHeight:440}};
// options.maximize=false leaves a restored maximized window unmaximized, for a caller that
// maximizes it when it shows the window (maximize() on a hidden window shows it).
function setVaultWindow(window,mode,workArea,options={}){
 if(!["setup","lock","app"].includes(mode))throw Error("INVALID_WINDOW_MODE");
 if(!window||window.isDestroyed())return false;
 if(mode!=="app"){
  if(!previous.has(window)){
   previous.set(window,{bounds:window.getNormalBounds(),min:window.getMinimumSize(),resizable:window.isResizable(),maximized:window.isMaximized()});
   if(window.isMaximized())window.unmaximize();
  }
  const size=SIZES[mode],width=Math.min(size.width,workArea.width),height=Math.min(size.height,workArea.height);
  window.setMinimumSize(Math.min(size.minWidth,width),Math.min(size.minHeight,height));window.setResizable(false);
  window.setBounds({x:workArea.x+Math.floor((workArea.width-width)/2),y:workArea.y+Math.floor((workArea.height-height)/2),width,height});
 }else{
  const old=previous.get(window);if(!old)return true;
  previous.delete(window);window.setMinimumSize(...old.min);window.setResizable(old.resizable);window.setBounds(old.bounds);
  if(old.maximized&&options.maximize!==false)window.maximize();
 }
 return true;
}
// The state saved when the window left the workspace size, or null while it is at that size.
function vaultPrevious(window){return previous.get(window)??null;}
module.exports={setVaultWindow,vaultPrevious};
