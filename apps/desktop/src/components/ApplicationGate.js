import {useCallback,useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import VaultUnlock from "./VaultUnlock";
import VaultWorkspace from "./VaultWorkspace";
const invoke=(method,...args)=>new Promise((resolve,reject)=>IpcSender.vault[method](...args,result=>result?.success?resolve(result.data):reject(Error("APPLICATION_UNAVAILABLE"))));
export default function ApplicationGate({uid,children}){
 const [screen,setScreen]=useState({mode:"CHECKING"}),sequence=useRef(0),live=useRef(true);
 const refresh=useCallback(async()=>{
  const request=++sequence.current;setScreen({mode:"CHECKING"});
  try{
   const result=await invoke("bootstrap",uid);
   const status=result.mode==="LOCKED"?await invoke("status"):null;
   if(live.current&&request===sequence.current)setScreen({...result,status});
  }catch{if(live.current&&request===sequence.current)setScreen({mode:"ERROR"});}
 },[uid]);
 useEffect(()=>{
  live.current=true;void refresh();
  const listener=IpcSender.onAll("vault/status",({data})=>{if(data?.uid===uid&&data.phase==="LOCKED")void refresh();});
  return()=>{live.current=false;sequence.current++;IpcSender.off("vault/status",listener);};
 },[uid,refresh]);
 const unlock=async(method,password)=>{
  await invoke("unlock",method,password);
  if(live.current)await refresh();
  return true;
 };
 if(["E2EE","LEGACY"].includes(screen.mode))return children;
 return <div className="application-gate" style={{padding:32,overflow:"auto",height:"100vh"}}>
  {screen.mode==="CHECKING"?<p role="status">계정의 저장소를 확인하고 있습니다…</p>:
   screen.mode==="LOCKED"?<VaultUnlock osAvailable={screen.status?.osAvailable} passwordAvailable={screen.status?.passwordAvailable}
    onOSUnlock={()=>unlock("os")} onPasswordUnlock={password=>unlock("password",password)}/>:
   screen.mode==="SETUP_REQUIRED"?<><h2>이 기기의 보관함 연결이 필요합니다</h2><VaultWorkspace uid={uid}/></>:
   screen.mode==="MIGRATION_REQUIRED"?<><p role="alert">계정의 암호화 이관 준비가 필요합니다. 기존 데이터는 그대로 보존되어 있습니다.</p><VaultWorkspace uid={uid} onContinue={()=>void refresh()}/></>:
   screen.mode==="RECOVERY_REQUIRED"?<p role="alert">보관함 파일 확인이 필요합니다. 초기화하거나 기존 데이터를 삭제하지 마세요.</p>:
   <p role="alert">저장소 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도해주세요. 다른 저장소로 자동 전환하지 않습니다.</p>}
  {screen.mode!=="CHECKING"&&<button onClick={()=>void refresh()}>저장소 다시 확인</button>}
 </div>;
}
