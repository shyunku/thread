import {useCallback,useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import VaultUnlock from "./VaultUnlock";
import RecoverySetup from "./RecoverySetup";
import DevicePairing from "./DevicePairing";
import RotationPanel from "./RotationPanel";
import LostRecoveryPanel from "./LostRecoveryPanel";
import BackupPanel from "./BackupPanel";
import ReencryptionPanel from "./ReencryptionPanel";
import { IoCloudDownloadOutline, IoKeyOutline, IoLockClosedOutline, IoPhonePortraitOutline, IoRefreshOutline, IoShieldCheckmarkOutline } from "react-icons/io5";
import "./VaultWorkspace.scss";
const invoke=(method,...args)=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.[method])return reject(Error("UNAVAILABLE"));
 IpcSender.vault[method](...args,response=>response?.success?resolve(response.data):reject(Error("VAULT_ACTION_FAILED")));
});
export default function VaultWorkspace({uid,onLocked,preview=false,initialPanel=null}){
 const [panel,setPanel]=useState(initialPanel);
 const [status,setStatus]=useState(preview?{uid,phase:"UNLOCKED",generation:1,osAvailable:true}:null),[error,setError]=useState(false);
 const generation=useRef(0);
 const invalidate=useCallback(()=>{generation.current++;},[]);
 useEffect(()=>{
  if(preview)return;
  let active=true;const request=++generation.current;
  setStatus(null);setError(false);
  invoke("status").then(data=>{
   if(!active||request!==generation.current||(data.uid!==uid&&data.enabled!==false))return;
   setStatus(data);
  }).catch(()=>{if(active&&request===generation.current)setError(true);});
  const listener=IpcSender.onAll("vault/status",({data})=>{
   if(!active||data?.uid!==uid)return;
   generation.current++;setStatus(previous=>({...previous,...data}));
  });
  return ()=>{active=false;invalidate();IpcSender.off("vault/status",listener);};
 },[uid,invalidate,preview]);
 const act=async(method,...args)=>{
  const request=generation.current;
  const next=await invoke(method,...args);
  if(request!==generation.current||next.uid!==uid)throw Error("SESSION_CHANGED");
  setStatus(next);setError(false);
  return true;
 };
 if(status?.enabled===false)return <p>이 빌드에서는 보관함을 사용할 수 없습니다.</p>;
 const current=status?.uid===uid?status:null;
  return <section className="vault-workspace" aria-label="데이터 관리">
  <h3>보호된 데이터 관리</h3><p>복구 자료와 연결된 기기를 관리하세요.</p>
  {error&&<p role="alert">보관함 상태를 확인하지 못했습니다. 기존 데이터는 삭제되지 않았습니다.</p>}
  {!current?<p>상태 확인 중…</p>:current.phase==="RECOVERY_REQUIRED"?<p role="alert">보관함 파일이 불완전합니다. 새로 만들거나 초기화하지 말고 복구가 필요합니다.</p>:
   current.phase==="UNLOCKED"?<>
    <p className="vault-status" role="status">데이터 잠금 해제됨</p>
     {!panel?<nav className="vault-menu" aria-label="데이터 관리 작업">{[["recovery","복구 자료","복구 코드와 파일 보관",<IoKeyOutline/>],["pair","기기 연결","QR 또는 파일로 새 기기 승인",<IoPhonePortraitOutline/>],["backup","암호화 백업","파일 내보내기·복원",<IoCloudDownloadOutline/>],["rotation","기기·키 관리","기기 해지와 키 갱신",<IoShieldCheckmarkOutline/>],["lost","기기 분실 복구","복구 자료로 접근 복원",<IoLockClosedOutline/>],["reencrypt","암호화 갱신","기존 데이터의 키 세대 갱신",<IoRefreshOutline/>]].map(([id,title,description,icon])=><button key={id} onClick={()=>setPanel(id)}><span className="vault-menu__title">{icon}<strong>{title}</strong></span><span>{description}</span></button>)}</nav>:<button className="vault-back" onClick={()=>setPanel(null)}>← 관리 메뉴</button>}
     {panel==="recovery"&&<RecoverySetup/>}
     {panel==="pair"&&<DevicePairing osAvailable={current.osAvailable}/>}
     {panel==="rotation"&&<RotationPanel osAvailable={current.osAvailable}/>}
     {panel==="lost"&&<LostRecoveryPanel osAvailable={current.osAvailable}/>}
     {panel==="backup"&&<BackupPanel osAvailable={current.osAvailable}/>}
     {panel==="reencrypt"&&<ReencryptionPanel/>}
    <button disabled={preview} onClick={()=>{generation.current++;setStatus({...current,phase:"LOCKED"});invoke("lock").then(()=>onLocked?.()).catch(()=>setError(true));}}>데이터 잠그기</button>
   </>:<VaultUnlock key={uid+":"+current.phase} setup={current.phase==="ABSENT"} osAvailable={current.osAvailable} passwordAvailable={current.passwordAvailable}
    onCreate={password=>act("create",password)} onOSUnlock={()=>act("unlock","os",undefined)} onPasswordUnlock={password=>act("unlock","password",password)}/>}
 </section>;
}
