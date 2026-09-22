import {useCallback,useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import VaultUnlock from "./VaultUnlock";
import VaultWorkspace from "./VaultWorkspace";
import {CircularProgress} from "react-cssfx-loading";
import "./ApplicationGate.scss";
const diagnosticCodes=new Set(["AUTH_REQUIRED","ACCOUNT_MISMATCH","VAULT_SESSION_CHANGED","VAULT_BUSY","APPLICATION_MODE_CHANGED","APPLICATION_MODE_UNAVAILABLE","INSECURE_SYNC_ENDPOINT","SYNC_UNAVAILABLE","SYNC_CANCELLED","UNAUTHORIZED","USER_REQUIRED"]);
const invoke=(method,...args)=>new Promise((resolve,reject)=>IpcSender.vault[method](...args,result=>result?.success?resolve(result.data):reject(Error(diagnosticCodes.has(result?.data?.code)?result.data.code:"APPLICATION_UNAVAILABLE"))));
export default function ApplicationGate({uid,children}){
 const [screen,setScreen]=useState({mode:"CHECKING"}),sequence=useRef(0),live=useRef(true);
 const refresh=useCallback(async()=>{
  const request=++sequence.current;setScreen({mode:"CHECKING"});
  try{
   const result=await invoke("bootstrap",uid);
   const status=result.mode==="LOCKED"?await invoke("status"):null;
   if(live.current&&request===sequence.current)setScreen({...result,status});
  }catch(error){if(live.current&&request===sequence.current)setScreen({mode:"ERROR",code:diagnosticCodes.has(error.message)?error.message:"APPLICATION_UNAVAILABLE"});}
 },[uid]);
 useEffect(()=>{
  live.current=true;void refresh();
  const listener=IpcSender.onAll("vault/status",({data})=>{if(data?.uid===uid&&data.phase==="LOCKED")void refresh();});
  return()=>{live.current=false;sequence.current++;IpcSender.off("vault/status",listener);};
 },[uid,refresh]);
 useEffect(()=>{
  if(screen.mode!=="CHECKING")IpcSender.vault.windowMode?.(["E2EE","LEGACY"].includes(screen.mode)?"app":"setup",()=>{});
 },[screen.mode]);
 useEffect(()=>()=>{IpcSender.vault.windowMode?.("app",()=>{});},[]);
 const unlock=async(method,password)=>{
  await invoke("unlock",method,password);
  if(live.current)await refresh();
  return true;
 };
 if(["E2EE","LEGACY"].includes(screen.mode))return children;
 const workspace=["SETUP_REQUIRED","MIGRATION_REQUIRED"].includes(screen.mode);
 const title={CHECKING:"작업 공간을 준비하고 있어요",LOCKED:"안전하게 이어서 시작하세요",SETUP_REQUIRED:"이 기기에 보관함 연결",MIGRATION_REQUIRED:"새로운 Thread를 시작할 준비",RECOVERY_REQUIRED:"보관함 확인이 필요해요",ERROR:"저장소에 연결하지 못했어요"}[screen.mode];
 return <main className={`application-gate${workspace?" application-gate--workspace":""}`}>
  <div className="application-gate__titlebar"><span>Thread</span><div><button aria-label="최소화" onClick={()=>IpcSender.system.minimizeWindow()}>−</button><button aria-label="닫기" onClick={()=>IpcSender.system.closeWindow()}>×</button></div></div>
  <div className="application-gate__card" aria-busy={screen.mode==="CHECKING"}>
  <header className="application-gate__header"><span className="application-gate__brand">Thread</span><h1>{title}</h1></header>
  {screen.mode==="CHECKING"?<div className="application-gate__checking" role="status"><CircularProgress color="#6294ff" width="32px" height="32px"/><p>계정의 저장소를 확인하고 있습니다…</p></div>:
   screen.mode==="LOCKED"?<><p className="application-gate__notice">이 기기에 기존 보관함이 있습니다. 잠금을 해제한 뒤 계정의 저장소를 확인합니다. 이 화면이 표시되는 것만으로 기존 할 일이 이관되지는 않습니다.</p><VaultUnlock osAvailable={screen.status?.osAvailable} passwordAvailable={screen.status?.passwordAvailable}
    onOSUnlock={()=>unlock("os")} onPasswordUnlock={password=>unlock("password",password)}/></>:
   screen.mode==="SETUP_REQUIRED"?<><p className="application-gate__notice">기존 기기의 연결 정보 또는 복구 키로 보관함을 연결해주세요.</p><VaultWorkspace uid={uid} connectionOnly onContinue={()=>void refresh()}/></>:
   screen.mode==="MIGRATION_REQUIRED"?<><p className="application-gate__notice">몇 단계만 거치면 기존 할 일을 v3로 안전하게 옮길 수 있어요.</p><VaultWorkspace uid={uid} onContinue={()=>void refresh()}/></>:
   screen.mode==="RECOVERY_REQUIRED"?<p role="alert">보관함 파일 확인이 필요합니다. 초기화하거나 기존 데이터를 삭제하지 마세요.</p>:
   <p role="alert">저장소 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도해주세요. 다른 저장소로 자동 전환하지 않습니다.</p>}
  {screen.mode==="ERROR"&&<p className="application-gate__diagnostic">진단 코드: <code>{screen.code}</code></p>}
  {screen.mode!=="CHECKING"&&<footer className="application-gate__footer"><button type="button" onClick={()=>void refresh()}>저장소 다시 확인</button><small>기존 데이터는 초기화하거나 삭제하지 않습니다.</small></footer>}
  </div>
 </main>;
}
