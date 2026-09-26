import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import Toast from "../molecules/Toast";
import VaultRegistration from "./VaultRegistration";
import PasswordField from "./PasswordField";
import {VscCopy} from "react-icons/vsc";
import "./RecoverySetup.scss";
const call=(method,...args)=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.[method])return reject(Error("UNAVAILABLE"));
 IpcSender.vault[method](...args,response=>response?.success?resolve(response.data):reject(Error(response?.data?.code==="RECOVERY_FILE_EXISTS"?"RECOVERY_FILE_EXISTS":"RECOVERY_FAILED")));
});
export default function RecoverySetup({onRegistered,newAccount=false}){
 const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false),[copied,setCopied]=useState(false),[preview,setPreview]=useState(""),[step,setStep]=useState("save");
 const live=useRef(true),pending=useRef(false),input=useRef(null);
 useEffect(()=>{
  live.current=true;let active=true;
  (async()=>{
   let value=await call("identityStatus");
   if(!value)value=await call("prepareIdentity");
   if(active)setState(value);
  })().catch(()=>{if(active)setError("RECOVERY_FAILED");});
  return ()=>{active=false;live.current=false;};
 },[]);
 const run=async action=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError("");
  try{await action();}catch(error){if(live.current)setError(error.message);}
  finally{pending.current=false;if(live.current)setBusy(false);}
 };
 if(state?.phase==="RECOVERY_CONFIRMED"&&onRegistered)return <section aria-label="계정 등록 최종 확인"><h3>백업 수단 설정을 마쳤어요</h3><VaultRegistration newAccount={newAccount} onRegistered={onRegistered}/></section>;
 return <section className="recovery-setup" aria-label="백업 수단 설정">
  {state?.phase==="RECOVERY_CONFIRMED"?<><h3>백업 수단 설정 완료</h3><p role="status">복구 자료 확인 완료</p>{!onRegistered&&<VaultRegistration newAccount={newAccount} onRegistered={onRegistered}/>}</>:
   step==="save"?<>
   <h3>백업 수단 설정</h3>
    {state?.recoveryStale&&<p role="alert">다른 기기에서 복구 자료가 바뀌었습니다. 기기·키 관리에서 새 자료를 준비해주세요.</p>}
    {!state?error?<button type="button" disabled={busy} onClick={()=>run(async()=>{
     let value=await call("identityStatus");if(!value)value=await call("prepareIdentity");
     if(live.current)setState(value);
    })}>백업 수단 다시 시도</button>:<p role="status">백업 수단을 준비하고 있어요…</p>:<>
     {!saved&&<><p>PC를 잃어버렸을 때 데이터를 되찾기 위한 준비예요. 로그인 비밀번호와는 별개입니다.</p>
      <p>먼저 암호화된 복구 파일을 안전한 곳에 저장하세요.</p>
      <button type="button" disabled={busy||state.recoveryStale} onClick={()=>run(async()=>{
      const ok=await call("exportRecovery");if(ok!==true)throw Error("RECOVERY_SAVE_CANCELLED");
      if(live.current)setSaved(true);
      const value=await call("recoveryCodePreview");if(live.current)setPreview(value);
     })}>복구 파일 저장</button></>}
     {saved&&<>
      <p>이제 복구 코드를 파일과 다른 안전한 곳에 저장하세요. 복원할 때 둘 다 필요합니다.</p>
      <div className="recovery-setup__code">
       <span className="recovery-setup__code-label">복구 코드</span>
       <button type="button" aria-label="복구 코드 복사" title="복구 코드 복사" disabled={busy} onClick={()=>run(async()=>{
        await call("copyRecoveryCode");if(live.current){setCopied(true);Toast.success("복사되었어요",{duration:3000});}
       })}><span>{preview||"복구 코드 복사"}</span><VscCopy aria-hidden="true"/></button>
       <small>안전한 곳에 따로 저장하세요. 클립보드는 30초 뒤 비워집니다.</small>
      </div>
      <button type="button" disabled={busy||!copied} onClick={()=>{setError("");setStep("confirm");}}>저장했어요</button>
     </>}
    </>}
   </>:<>
    <h3>복구 코드 확인</h3>
    <p>저장한 코드를 입력하고 복구 파일을 다시 열어 확인하세요.</p>
    <form className="recovery-setup__confirm" onSubmit={event=>{event.preventDefault();const value=input.current.value;input.current.value="";
     run(async()=>{const next=await call("confirmRecovery",value);if(live.current&&next)setState(next);});}}>
     <label htmlFor="recovery-code">기록한 복구 코드</label>
     <div className="recovery-setup__confirm-row"><PasswordField ref={input} id="recovery-code" label="복구 코드" autoComplete="off" maxLength={128} required disabled={busy}/><button disabled={busy} type="submit">복구 코드 확인</button></div>
    </form>
    <button type="button" className="recovery-setup__back" disabled={busy} onClick={()=>{setError("");setStep("save");}}>← 백업 수단 설정</button>
   </>}
  {error&&error!=="RECOVERY_SAVE_CANCELLED"&&<p role="alert">{error==="RECOVERY_FILE_EXISTS"?"같은 이름의 파일이 이미 있습니다. 기존 파일은 변경하지 않았어요. 다른 이름으로 저장해주세요.":"복구 자료를 확인하지 못했습니다. 파일 저장과 코드를 다시 확인해주세요. 기존 데이터는 변경되지 않았습니다."}</p>}
 </section>;
}
