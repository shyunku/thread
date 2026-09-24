import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import VaultRegistration from "./VaultRegistration";
import PasswordField from "./PasswordField";
const call=(method,...args)=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.[method])return reject(Error("UNAVAILABLE"));
 IpcSender.vault[method](...args,response=>response?.success?resolve(response.data):reject(Error(response?.data?.code==="RECOVERY_FILE_EXISTS"?"RECOVERY_FILE_EXISTS":"RECOVERY_FAILED")));
});
export default function RecoverySetup({onRegistered,newAccount=false}){
 const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false),[copied,setCopied]=useState(false);
 const live=useRef(true),pending=useRef(false),input=useRef(null);
 useEffect(()=>{
  live.current=true;let active=true;
  call("identityStatus").then(value=>{if(active)setState(value);}).catch(()=>{if(active)setError("RECOVERY_FAILED");});
  return ()=>{active=false;live.current=false;};
 },[]);
 useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),30000);return ()=>clearTimeout(timer);},[copied]);
 const run=async action=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError("");
  try{await action();}catch(error){if(live.current)setError(error.message);}
  finally{pending.current=false;if(live.current)setBusy(false);}
 };
 if(state?.phase==="RECOVERY_CONFIRMED"&&onRegistered)return <section aria-label="계정 등록 최종 확인"><h3>복구 준비를 마쳤어요</h3><VaultRegistration newAccount={newAccount} onRegistered={onRegistered}/></section>;
 return <section aria-label="데이터 복구 준비">
  <h3>데이터 복구 준비</h3>
  <p>PC를 잃어버렸을 때 데이터를 되찾기 위한 준비예요. 로그인 비밀번호와는 별개입니다.</p>
  {!state?<button disabled={busy} onClick={()=>run(async()=>{const value=await call("prepareIdentity");if(live.current)setState(value);})}>복구 자료 만들기</button>:<>
   {state.recoveryStale&&<p role="alert">다른 기기에서 복구 자료가 바뀌었습니다. 기기·키 관리에서 새 자료를 준비해주세요.</p>}
   {state.phase==="RECOVERY_CONFIRMED"?<><p role="status">복구 자료 확인 완료</p>{!onRegistered&&<VaultRegistration newAccount={newAccount} onRegistered={onRegistered}/>}</>:<>
    <p>암호화된 복구 파일을 저장하고 코드를 복사해 따로 보관하세요. 복원할 때 <strong>파일과 코드가 모두 필요</strong>합니다.</p>
    {!saved&&<button disabled={busy} onClick={()=>run(async()=>{const ok=await call("exportRecovery");if(ok!==true)throw Error("RECOVERY_SAVE_CANCELLED");if(live.current)setSaved(true);await call("copyRecoveryCode");if(live.current)setCopied(true);})}>복구 파일 저장하고 코드 복사</button>}
    {saved&&<button type="button" disabled={busy} onClick={()=>run(async()=>{await call("copyRecoveryCode");if(live.current)setCopied(true);})}>코드 다시 복사</button>}
    {copied&&<p role="status">코드를 복사했어요. 안전한 곳에 따로 저장하세요. 클립보드는 30초 뒤 비워집니다.</p>}
    {saved&&<><p>② 저장한 파일과 기록한 코드가 맞는지 확인하세요. 확인하지 않으면 다음 단계로 넘어가지 않습니다.</p>
     <form onSubmit={event=>{event.preventDefault();const value=input.current.value;input.current.value="";
      run(async()=>{const next=await call("confirmRecovery",value);if(live.current&&next)setState(next);});}}>
      <label htmlFor="recovery-code">기록한 복구 코드</label><PasswordField ref={input} id="recovery-code" label="복구 코드" autoComplete="off" maxLength={128} required disabled={busy}/>
      <button disabled={busy} type="submit">복구 자료 확인</button>
     </form></>}
   </>}
  </>}
  {error&&error!=="RECOVERY_SAVE_CANCELLED"&&<p role="alert">{error==="RECOVERY_FILE_EXISTS"?"같은 이름의 파일이 이미 있습니다. 기존 파일은 변경하지 않았어요. 다른 이름으로 저장해주세요.":"복구 자료를 확인하지 못했습니다. 파일 저장과 코드를 다시 확인해주세요. 기존 데이터는 변경되지 않았습니다."}</p>}
 </section>;
}
