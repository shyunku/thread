import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import PasswordField from "./PasswordField";
const call=(name,...args)=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.[name])return reject(Error("UNAVAILABLE"));
 IpcSender.vault[name](...args,result=>result?.success?resolve(result.data):reject(Error("MIGRATION_FAILED")));
});
 const labels={NOT_STARTED:"시작 전",PREPARING:"기존 데이터 확인 중",FROZEN:"기존 데이터 확인 완료",UPLOADING:"암호화해 이동 중",VERIFIED:"새 데이터 확인 완료",COMMITTING:"이동 결과 확인 중",ACTIVE:"데이터 이동 완료",CANCELLED:"취소 완료"};
export default function MigrationPanel({osAvailable,onContinue}){
 const [state,setState]=useState(null),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[error,setError]=useState(false);
 const [method,setMethod]=useState(osAvailable?"os":"password"),password=useRef(null),live=useRef(true),pending=useRef(false);
 useEffect(()=>{
  live.current=true;let active=true;
  call("migrationStatus").then(value=>{if(active)setState(value);}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;live.current=false;};
 },[]);
 const run=async action=>{
  if(pending.current||!consent)return;
  pending.current=true;setBusy(true);setError(false);
  const input={confirmed:true,method,password:method==="password"?password.current?.value:undefined};
  if(password.current)password.current.value="";
  try{
   const result=await call("migration",action,input);
   if(live.current){setState(result);setConsent(false);}
  }catch{if(live.current)setError(true);}
  finally{input.password=undefined;pending.current=false;if(live.current)setBusy(false);}
 };
 const phase=state?.phase,waiting=busy||state?.busy;
 return <section aria-label="암호화 이관">
  <h3>기존 데이터 옮기기</h3>
  <p>기존 데이터를 새 보호 방식으로 옮깁니다. 시작 전에 다른 기기의 Thread를 닫아주세요.</p>
  <details><summary>기존 데이터는 어떻게 되나요?</summary><p>기존 데이터와 아직 보내지 못한 변경은 보존됩니다. 과거 서버 기록과 백업은 나중에 별도로 정리해야 합니다.</p></details>
  <p role="status">{state?labels[phase]||"상태 확인 필요":"상태 확인 중"}</p>
  {error&&<p role="alert">데이터 이동을 완료하지 못했어요. 연결을 확인한 뒤 같은 단계에서 다시 시도해주세요. 기존 데이터는 초기화하지 마세요.</p>}
  {phase!=="ACTIVE"&&<>
   <label><input type="checkbox" checked={consent} disabled={waiting} onChange={event=>setConsent(event.target.checked)}/>복구 코드와 파일을 보관했고, 데이터 이동 중 다른 기기에서 편집하지 않는 데 동의합니다.</label>
   <label>재인증 방법<select value={method} disabled={waiting} onChange={event=>setMethod(event.target.value)}>
    {osAvailable&&<option value="os">OS 인증</option>}<option value="password">보관함 비밀번호</option>
   </select></label>
   {method==="password"&&<><label htmlFor="migration-password">보관함 비밀번호</label><PasswordField ref={password} id="migration-password" label="보관함 비밀번호" autoComplete="off" maxLength={1024} disabled={waiting}/></>}
   {["NOT_STARTED","PREPARING","FROZEN"].includes(phase)&&<button disabled={!consent||waiting} onClick={()=>run("prepare")}>기존 데이터 확인</button>}
   {phase==="CANCELLED"&&<button disabled={!consent||waiting} onClick={()=>run("restart")}>다시 시작</button>}
   {phase==="PREPARING"&&<button disabled={!consent||waiting} onClick={()=>run("refresh")}>기존 데이터 다시 확인</button>}
   {["FROZEN","UPLOADING","VERIFIED","COMMITTING"].includes(phase)&&<button disabled={!consent||waiting} onClick={()=>run("transfer")}>데이터 이동·이어하기</button>}
   {["PREPARING","FROZEN","UPLOADING","VERIFIED","COMMITTING"].includes(phase)&&<button disabled={!consent||waiting} onClick={()=>run("cancel")}>이동 취소</button>}
  </>}
  {phase==="ACTIVE"&&<p>서버 전환을 확인했습니다. 다음 단계에서 서명된 snapshot으로 이 기기를 연결합니다. 보존된 이전 변경은 별도로 검토하세요.</p>}
  {phase==="CANCELLED"&&<p>기존 원본과 이전 이관 기록은 유지됩니다. 재인증 후 서버의 취소 상태를 다시 확인하고 새 시도를 만들 수 있습니다. 원본 준비는 별도 동의 후 시작합니다.</p>}
  {onContinue&&["ACTIVE","CANCELLED"].includes(phase)&&<button onClick={onContinue}>저장소 다시 확인</button>}
 </section>;
}
