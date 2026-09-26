import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import PasswordField from "./PasswordField";
import {VscChevronRight} from "react-icons/vsc";
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
 return <section className="migration-panel" aria-label="암호화 이관">
  <h3>기존 데이터 옮기기</h3>
  {phase!=="ACTIVE"&&<p>기존 데이터를 암호화해 옮겨요. 시작 전에 다른 기기에서 실행 중인 Thread를 닫아주세요.</p>}
  {!(["NOT_STARTED","ACTIVE"].includes(phase))&&<p className="migration-panel__status" role="status">{state?labels[phase]||"상태 확인 필요":"상태 확인 중"}</p>}
  {error&&<p role="alert">데이터 이동을 완료하지 못했어요. 연결을 확인한 뒤 같은 단계에서 다시 시도해주세요. 기존 데이터는 초기화하지 마세요.</p>}
  {phase==="ACTIVE"?<><p>데이터 이동을 마쳤어요. 이제 새 방식으로 Thread를 시작할 수 있습니다.</p>{onContinue&&<button type="button" className="migration-panel__primary" onClick={onContinue}>Thread 시작하기</button>}</>:
   <>
    {phase==="CANCELLED"&&<p>이동을 취소했어요. 기존 데이터는 그대로 보존됩니다. 다시 시작할 수 있습니다.</p>}
    <div className="migration-panel__form">
     <label className="migration-panel__consent"><input type="checkbox" checked={consent} disabled={waiting} onChange={event=>setConsent(event.target.checked)}/><span>복구 코드와 파일을 보관했고, 이동 중 다른 기기에서 편집하지 않겠습니다.</span></label>
     <fieldset className="migration-panel__methods"><legend>본인 확인 방법</legend><div>
      {osAvailable&&<label><input type="radio" name="migration-method" value="os" checked={method==="os"} disabled={waiting} onChange={()=>setMethod("os")}/>OS 인증</label>}
      <label><input type="radio" name="migration-method" value="password" checked={method==="password"} disabled={waiting} onChange={()=>setMethod("password")}/>데이터 잠금 비밀번호</label>
     </div></fieldset>
     {method==="password"&&<><label htmlFor="migration-password">데이터 잠금 비밀번호</label><PasswordField ref={password} id="migration-password" label="데이터 잠금 비밀번호" autoComplete="off" maxLength={1024} disabled={waiting}/></>}
     <div className="migration-panel__actions">
      {["NOT_STARTED","PREPARING","FROZEN"].includes(phase)&&<button type="button" className="migration-panel__primary" disabled={!consent||waiting} onClick={()=>run("prepare")}>기존 데이터 확인</button>}
      {phase==="CANCELLED"&&<button type="button" className="migration-panel__primary" disabled={!consent||waiting} onClick={()=>run("restart")}>다시 시작</button>}
      {phase==="PREPARING"&&<button type="button" disabled={!consent||waiting} onClick={()=>run("refresh")}>기존 데이터 다시 확인</button>}
      {["FROZEN","UPLOADING","VERIFIED","COMMITTING"].includes(phase)&&<button type="button" className="migration-panel__primary" disabled={!consent||waiting} onClick={()=>run("transfer")}>데이터 이동·이어하기</button>}
      {["PREPARING","FROZEN","UPLOADING","VERIFIED","COMMITTING"].includes(phase)&&<button type="button" disabled={!consent||waiting} onClick={()=>run("cancel")}>이동 취소</button>}
     </div>
    </div>
    <details><summary><span>기존 데이터는 어떻게 되나요?</span><VscChevronRight aria-hidden="true"/></summary><p>기존 데이터와 아직 보내지 못한 변경은 보존됩니다. 과거 서버 기록과 백업은 나중에 별도로 정리해야 합니다.</p></details>
   </>}
 </section>;
}
