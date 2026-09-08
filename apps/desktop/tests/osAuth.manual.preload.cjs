const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("authFixture",{verify:()=>ipcRenderer.invoke("fixture/verify")});
