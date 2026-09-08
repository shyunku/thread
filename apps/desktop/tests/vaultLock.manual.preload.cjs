const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("vaultFixture",{
  act:(action,password)=>ipcRenderer.invoke("fixture/vault",action,password),
  onLocked:callback=>{const listener=()=>callback();ipcRenderer.on("fixture/locked",listener);
    return ()=>ipcRenderer.removeListener("fixture/locked",listener);},
});
