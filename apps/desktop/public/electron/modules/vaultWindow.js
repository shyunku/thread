const previous=new WeakMap();
function setVaultWindow(window,mode,workArea){
 if(!["setup","app"].includes(mode))throw Error("INVALID_WINDOW_MODE");
 if(!window||window.isDestroyed())return false;
 if(mode==="setup"){
  if(previous.has(window))return true;
  previous.set(window,{bounds:window.getNormalBounds(),min:window.getMinimumSize(),resizable:window.isResizable(),maximized:window.isMaximized()});
  if(window.isMaximized())window.unmaximize();
  const width=Math.min(620,workArea.width),height=Math.min(820,workArea.height);
  window.setMinimumSize(Math.min(360,width),Math.min(420,height));window.setResizable(false);
  window.setBounds({x:workArea.x+Math.floor((workArea.width-width)/2),y:workArea.y+Math.floor((workArea.height-height)/2),width,height});
 }else{
  const old=previous.get(window);if(!old)return true;
  previous.delete(window);window.setMinimumSize(...old.min);window.setResizable(old.resizable);window.setBounds(old.bounds);
  if(old.maximized)window.maximize();
 }
 return true;
}
module.exports={setVaultWindow};
