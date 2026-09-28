import {useCallback,useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import VaultUnlock from "./VaultUnlock";
import LegacyRecovery from "./LegacyRecovery";
import RecoverySetup from "./RecoverySetup";
import DevicePairing from "./DevicePairing";
import RotationPanel from "./RotationPanel";
import LostRecoveryPanel from "./LostRecoveryPanel";
import BackupPanel from "./BackupPanel";
import LegacyStructureReview from "./LegacyStructureReview";
import ReencryptionPanel from "./ReencryptionPanel";
import VaultOnboarding from "./VaultOnboarding";
import { IoCloudDownloadOutline, IoKeyOutline, IoLockClosedOutline, IoPhonePortraitOutline, IoRefreshOutline, IoShieldCheckmarkOutline } from "react-icons/io5";
import "./VaultWorkspace.scss";
const invoke=(method,...args)=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.[method])return reject(Error("UNAVAILABLE"));
 IpcSender.vault[method](...args,response=>response?.success?resolve(response.data):reject(Error("VAULT_ACTION_FAILED")));
});
export default function VaultWorkspace({uid,onContinue,onStarted,onLocked,connectionOnly=false,newAccount=false,preview=false}){
 const [panel,setPanel]=useState(null);
 const [onboardingStep,setOnboardingStep]=useState("recovery");
 const [status,setStatus]=useState(preview?{uid,phase:"UNLOCKED",generation:1,osAvailable:true}:null),[error,setError]=useState(false),[intakes,setIntakes]=useState([]),[selected,setSelected]=useState("");
 const generation=useRef(0);
 const invalidate=useCallback(()=>{generation.current++;},[]);
 useEffect(()=>{
  if(preview)return;
  let active=true;const request=++generation.current;
  setStatus(null);setIntakes([]);setSelected("");setError(false);
  invoke("status").then(async data=>{
   if(!active||request!==generation.current||(data.uid!==uid&&data.enabled!==false))return;
   setStatus(data);
   if(data.phase==="UNLOCKED"){
    const list=await invoke("intakes");
    if(active&&request===generation.current){setIntakes(list);setSelected(list[0]?.id||"");}
   }
  }).catch(()=>{if(active&&request===generation.current)setError(true);});
  const listener=IpcSender.onAll("vault/status",({data})=>{
   if(!active||data?.uid!==uid)return;
   generation.current++;setStatus(previous=>({...previous,...data}));setIntakes([]);setSelected("");
  });
  return ()=>{active=false;invalidate();IpcSender.off("vault/status",listener);};
 },[uid,invalidate,preview]);
 const act=async(method,...args)=>{
  const request=generation.current;
  const next=await invoke(method,...args);
  if(request!==generation.current||next.uid!==uid)throw Error("SESSION_CHANGED");
  setStatus(next);setError(false);
  if(next.phase==="UNLOCKED"){
   const list=await invoke("intakes");
   if(request!==generation.current)throw Error("SESSION_CHANGED");
   setIntakes(list);setSelected(list[0]?.id||"");
  }
  return true;
 };
 const loadPage=useCallback(request=>invoke("reviews",request),[]);
 const reconcileLegacy=useCallback(request=>invoke("reconcileLegacy",request),[]);
 useEffect(()=>{if(newAccount&&status?.uid===uid&&status.phase==="UNLOCKED")onStarted?.();},[newAccount,status?.uid,status?.phase,uid,onStarted]);
 if(status?.enabled===false)return <p>이 빌드에서는 보관함을 사용할 수 없습니다.</p>;
 const current=status?.uid===uid?status:null;
 const progressStep=current?.phase!=="UNLOCKED"?1:["migration","activate"].includes(onboardingStep)?3:2;
  return <section className="vault-workspace" aria-label="데이터 관리">
  {onContinue&&!connectionOnly&&<ol className="vault-progress" aria-label={newAccount?"새 데이터 설정 진행 단계":"데이터 보호 업데이트 진행 단계"}>{(newAccount?["암호화 준비","백업 수단 저장","시작"]:["본인 확인","백업 수단 저장","데이터 이동"]).map((label,index)=><li key={label} className={index+1<=progressStep?"vault-progress__reached":""} aria-current={index+1===progressStep?"step":undefined}>{index+1}. {label}</li>)}</ol>}
  {!onContinue&&<><h3>보호된 데이터 관리</h3><p>복구 자료와 연결된 기기를 관리하세요.</p></>}
  {error&&<p role="alert">보관함 상태를 확인하지 못했습니다. 기존 데이터는 삭제되지 않았습니다.</p>}
  {!current?<p>상태 확인 중…</p>:current.phase==="RECOVERY_REQUIRED"?<p role="alert">보관함 파일이 불완전합니다. 새로 만들거나 초기화하지 말고 복구가 필요합니다.</p>:
   current.phase==="UNLOCKED"?<>
    {!onContinue&&<p className="vault-status" role="status">데이터 잠금 해제됨</p>}
    {onContinue?<VaultOnboarding key={uid+":"+current.generation} osAvailable={current.osAvailable} onContinue={onContinue} connectionOnly={connectionOnly} newAccount={newAccount} onStepChange={setOnboardingStep}/>:<>
     {!panel?<nav className="vault-menu" aria-label="데이터 관리 작업">{[["recovery","복구 자료","복구 코드와 파일 보관",<IoKeyOutline/>],["pair","기기 연결","QR 또는 파일로 새 기기 승인",<IoPhonePortraitOutline/>],["backup","암호화 백업","파일 내보내기·복원",<IoCloudDownloadOutline/>],["rotation","기기·키 관리","기기 해지와 키 갱신",<IoShieldCheckmarkOutline/>],["lost","기기 분실 복구","복구 자료로 접근 복원",<IoLockClosedOutline/>],["reencrypt","암호화 갱신","기존 데이터의 키 세대 갱신",<IoRefreshOutline/>]].map(([id,title,description,icon])=><button key={id} onClick={()=>setPanel(id)}><span className="vault-menu__title">{icon}<strong>{title}</strong></span><span>{description}</span></button>)}</nav>:<button className="vault-back" onClick={()=>setPanel(null)}>← 관리 메뉴</button>}
     {preview&&panel&&<p>미리보기에서는 실제 계정 데이터를 열지 않습니다. 메뉴 배치만 확인할 수 있습니다.</p>}
     {!preview&&panel==="recovery"&&<RecoverySetup/>}
     {!preview&&panel==="pair"&&<DevicePairing osAvailable={current.osAvailable}/>}
     {!preview&&panel==="rotation"&&<RotationPanel osAvailable={current.osAvailable}/>}
     {!preview&&panel==="lost"&&<LostRecoveryPanel osAvailable={current.osAvailable}/>}
     {!preview&&panel==="backup"&&<BackupPanel osAvailable={current.osAvailable}/>}
     {!preview&&panel==="reencrypt"&&<ReencryptionPanel/>}
    </>}
    {!onContinue&&<><button disabled={preview} onClick={()=>{generation.current++;setIntakes([]);setSelected("");setStatus({...current,phase:"LOCKED"});invoke("lock").then(()=>onLocked?.()).catch(()=>setError(true));}}>데이터 잠그기</button>
    {intakes.length>0&&<>
     <label>복구 자료 <select value={selected} onChange={event=>setSelected(event.target.value)}>{intakes.map((item,index)=><option key={item.id} value={item.id}>자료 {index+1} · {item.count}개</option>)}</select></label>
     {selected&&<LegacyRecovery key={selected} sessionKey={uid+":"+current.generation} intakeId={selected} unlocked loadPage={loadPage} onReconcile={reconcileLegacy}/>}
     {selected&&<LegacyStructureReview key={"structure:"+selected} intakeId={selected}/>}
    </>}</>}
   </>:<VaultUnlock preparationOnly key={uid+":"+current.phase} setup={current.phase==="ABSENT"} osAvailable={current.osAvailable} passwordAvailable={current.passwordAvailable}
    onCreate={password=>act("create",password)} onOSUnlock={()=>act("unlock","os",undefined)} onPasswordUnlock={password=>act("unlock","password",password)}/>}
 </section>;
}
