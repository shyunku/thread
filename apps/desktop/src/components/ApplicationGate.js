import {useCallback,useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import VaultUnlock from "./VaultUnlock";
import LockScreen from "./LockScreen";
import VaultWorkspace from "./VaultWorkspace";
import DeviceConnect from "./gate/DeviceConnect";
import {CircularProgress} from "react-cssfx-loading";
import {VscChromeMinimize,VscChromeClose,VscRefresh} from "react-icons/vsc";
import "./ApplicationGate.scss";
const diagnosticCodes=new Set(["AUTH_REQUIRED","ACCOUNT_MISMATCH","VAULT_SESSION_CHANGED","VAULT_BUSY","APPLICATION_MODE_CHANGED","APPLICATION_MODE_UNAVAILABLE","MIGRATION_UNAVAILABLE","MIGRATION_IN_PROGRESS","INSECURE_SYNC_ENDPOINT","SYNC_UNAVAILABLE","SYNC_CANCELLED","UNAUTHORIZED","USER_REQUIRED"]);
const invoke=(method,...args)=>new Promise((resolve,reject)=>IpcSender.vault[method](...args,result=>result?.success?resolve(result.data):reject(Error(diagnosticCodes.has(result?.data?.code)?result.data.code:"APPLICATION_UNAVAILABLE"))));
export default function ApplicationGate({uid,children}){
 const [screen,setScreen]=useState({mode:"CHECKING"}),[introSeenFor,setIntroSeenFor]=useState(null),[setupProgressed,setSetupProgressed]=useState(false),sequence=useRef(0),live=useRef(true);
 const refresh=useCallback(async()=>{
  const request=++sequence.current;setScreen({mode:"CHECKING"});
  try{
   const result=await invoke("bootstrap",uid);
   if(result.mode==="LEGACY")throw Error("APPLICATION_MODE_UNAVAILABLE");
   const status=result.mode==="LOCKED"?await invoke("status"):null;
   if(live.current&&request===sequence.current)setScreen({...result,status});
  }catch(error){if(live.current&&request===sequence.current)setScreen({mode:"ERROR",code:diagnosticCodes.has(error.message)?error.message:"APPLICATION_UNAVAILABLE"});}
 },[uid]);
 useEffect(()=>{
  live.current=true;void refresh();
  const listener=IpcSender.onAll("vault/status",({data})=>{if(data?.uid===uid&&data.phase==="LOCKED")void refresh();});
  return()=>{live.current=false;sequence.current++;IpcSender.off("vault/status",listener);};
 },[uid,refresh]);
 useEffect(()=>setSetupProgressed(false),[uid]);
 // A plain lock uses the compact lock window; setup and migration flows keep the larger one.
 const plainLock=screen.mode==="LOCKED"&&!screen.migrationPending;
 useEffect(()=>{
  if(screen.mode!=="CHECKING")IpcSender.vault.windowMode?.(screen.mode==="E2EE"?"app":plainLock?"lock":"setup",()=>{});
 },[screen.mode,plainLock]);
 useEffect(()=>()=>{IpcSender.vault.windowMode?.("app",()=>{});},[]);
 const unlock=async(method,password)=>{
  await invoke("unlock",method,password);
  if(live.current)await refresh();
  return true;
 };
 if(screen.mode==="E2EE")return typeof children==="function"?children(screen.mode):children;
 const workspace=["MIGRATION_REQUIRED","NEW_ACCOUNT_SETUP"].includes(screen.mode);
 // Full-window step flows draw their own header and footer.
 const flow=screen.mode==="SETUP_REQUIRED";
 const showIntro=introSeenFor!==uid&&(screen.mode==="MIGRATION_REQUIRED"||(screen.mode==="LOCKED"&&screen.migrationPending));
 const title=showIntro?"데이터 보호 업데이트":{CHECKING:"작업 공간을 준비하고 있어요",LOCKED:"내 데이터 잠금 해제",SETUP_REQUIRED:"이 기기에서 데이터 연결",NEW_ACCOUNT_SETUP:"새 데이터 보호 설정",MIGRATION_REQUIRED:"데이터 보호 업데이트",RECOVERY_REQUIRED:"데이터 확인이 필요해요",ERROR:"데이터에 연결하지 못했어요"}[screen.mode];
 return <main className={`application-gate${workspace?" application-gate--workspace":""}${plainLock?" application-gate--lock":""}${flow?" application-gate--flow":""}`}>
  <div className="application-gate__titlebar"><span>Thread</span><div className="application-gate__window-actions"><button aria-label="최소화" onClick={()=>IpcSender.system.minimizeWindow()}><VscChromeMinimize aria-hidden="true"/></button><button aria-label="닫기" onClick={()=>IpcSender.system.closeWindow()}><VscChromeClose aria-hidden="true"/></button></div></div>
  <div className="application-gate__card" aria-busy={screen.mode==="CHECKING"}>
  {!(screen.mode==="NEW_ACCOUNT_SETUP"&&setupProgressed)&&!plainLock&&!flow&&<header className="application-gate__header"><div className="application-gate__heading"><h1>{title}</h1>{["ERROR","RECOVERY_REQUIRED"].includes(screen.mode)&&<button type="button" className="application-gate__refresh" aria-label="상태 다시 확인" title="상태 다시 확인" onClick={()=>void refresh()}><VscRefresh aria-hidden="true"/></button>}</div></header>}
  {screen.mode==="CHECKING"?<div className="application-gate__checking" role="status"><CircularProgress color="#6294ff" width="32px" height="32px"/><p>계정의 저장소를 확인하고 있습니다…</p></div>:
   showIntro?<section className="application-gate__intro"><p>새 버전은 데이터를 이 기기에서 암호화한 뒤 동기화해요. 기존 데이터를 계속 사용하려면 한 번만 새 방식으로 옮겨야 합니다.</p><p>이동은 동의한 뒤에만 시작되며, 기존 데이터는 바로 삭제되지 않아요.</p><button type="button" onClick={()=>setIntroSeenFor(uid)}>계속</button></section>:
   plainLock?<LockScreen osAvailable={screen.status?.osAvailable} passwordAvailable={screen.status?.passwordAvailable}
    onOSUnlock={()=>unlock("os")} onPasswordUnlock={password=>unlock("password",password)}/>:
   screen.mode==="LOCKED"?<>{screen.migrationPending&&<ol className="application-gate__progress" aria-label="데이터 보호 업데이트 진행 단계"><li aria-current="step">1. 본인 확인</li><li>2. 백업 수단 저장</li><li>3. 데이터 이동</li></ol>}<p className="application-gate__notice">이 기기의 암호화된 데이터를 보호하기 위해 본인 확인이 필요해요. 처음 업데이트하는 경우 잠금 해제 후 데이터 이동을 안내합니다. 지금 확인만으로 데이터가 이동되지는 않아요.</p><VaultUnlock embedded osAvailable={screen.status?.osAvailable} passwordAvailable={screen.status?.passwordAvailable}
    onOSUnlock={()=>unlock("os")} onPasswordUnlock={password=>unlock("password",password)}/></>:
   screen.mode==="SETUP_REQUIRED"?<DeviceConnect key={uid} onConnected={()=>void refresh()}/>:
   screen.mode==="NEW_ACCOUNT_SETUP"?<>{!setupProgressed&&<p className="application-gate__notice">새 계정의 데이터는 처음부터 이 기기에서 암호화돼요. 잠금 방법과 복구 자료를 준비하면 시작할 수 있습니다.</p>}<VaultWorkspace uid={uid} newAccount onStarted={()=>setSetupProgressed(true)} onContinue={()=>void refresh()}/></>:
   screen.mode==="MIGRATION_REQUIRED"?<VaultWorkspace uid={uid} onContinue={()=>void refresh()}/>:
   screen.mode==="RECOVERY_REQUIRED"?<p role="alert">데이터 파일 확인이 필요합니다. 초기화하거나 기존 데이터를 삭제하지 마세요.</p>:
   <p role="alert">{screen.code==="MIGRATION_UNAVAILABLE"?"이 서버에서는 데이터 보호 업데이트를 시작할 수 없어요. 서버 설정을 확인한 뒤 다시 시도해주세요.":"데이터에 연결하지 못했어요. 연결을 확인하고 다시 시도해주세요. 기존 보호 방식으로 돌아가지는 않습니다."}</p>}
  {screen.mode==="ERROR"&&<p className="application-gate__diagnostic">진단 코드: <code>{screen.code}</code></p>}
  </div>
 </main>;
}
