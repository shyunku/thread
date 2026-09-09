import {useCallback,useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import VaultUnlock from "./VaultUnlock";
import LegacyRecovery from "./LegacyRecovery";
import RecoverySetup from "./RecoverySetup";
import DevicePairing from "./DevicePairing";
import EncryptedSync from "./EncryptedSync";
const invoke=(method,...args)=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.[method])return reject(Error("UNAVAILABLE"));
 IpcSender.vault[method](...args,response=>response?.success?resolve(response.data):reject(Error("VAULT_ACTION_FAILED")));
});
export default function VaultWorkspace({uid}){
 const [status,setStatus]=useState(null),[error,setError]=useState(false),[intakes,setIntakes]=useState([]),[selected,setSelected]=useState("");
 const generation=useRef(0);
 const invalidate=useCallback(()=>{generation.current++;},[]);
 useEffect(()=>{
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
 },[uid,invalidate]);
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
 if(status?.enabled===false)return <p>이 빌드에서는 보관함 개발 검증이 비활성화되어 있습니다.</p>;
 const current=status?.uid===uid?status:null;
 return <section aria-label="보관함 개발 검증">
  <h3>보관함 개발 검증</h3>
  <p>로컬 보관함을 준비하고 복구 확인 후 서버 등록을 별도로 요청할 수 있습니다. 기존 할 일 이관이나 서버 E2EE 활성화는 수행하지 않습니다.</p>
  {error&&<p role="alert">보관함 상태를 확인하지 못했습니다. 기존 데이터는 삭제되지 않았습니다.</p>}
  {!current?<p>상태 확인 중…</p>:current.phase==="RECOVERY_REQUIRED"?<p role="alert">보관함 파일이 불완전합니다. 새로 만들거나 초기화하지 말고 복구가 필요합니다.</p>:
   current.phase==="UNLOCKED"?<>
    <p role="status">로컬 보관함 잠금 해제됨 · 서버 E2EE 미전환</p>
    <RecoverySetup key={uid+":"+current.generation}/>
    <DevicePairing key={"pair:"+uid+":"+current.generation} osAvailable={current.osAvailable}/>
    <EncryptedSync key={"sync:"+uid+":"+current.generation}/>
    <button onClick={()=>{generation.current++;setIntakes([]);setSelected("");setStatus({...current,phase:"LOCKED"});invoke("lock").catch(()=>setError(true));}}>보관함 잠그기</button>
    {!intakes.length?<p>보존된 이전 기기 변경이 없습니다.</p>:<>
     <label>복구 자료 <select value={selected} onChange={event=>setSelected(event.target.value)}>{intakes.map((item,index)=><option key={item.id} value={item.id}>자료 {index+1} · {item.count}개</option>)}</select></label>
     {selected&&<LegacyRecovery sessionKey={uid+":"+current.generation} intakeId={selected} unlocked loadPage={loadPage}/>}
    </>}
   </>:<VaultUnlock preparationOnly key={uid+":"+current.phase} setup={current.phase==="ABSENT"} osAvailable={current.osAvailable} passwordAvailable={current.passwordAvailable}
    onCreate={password=>act("create",password)} onOSUnlock={()=>act("unlock","os",undefined)} onPasswordUnlock={password=>act("unlock","password",password)}/>}
 </section>;
}
