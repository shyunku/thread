import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import VaultRegistration from "./VaultRegistration";
import PasswordField from "./PasswordField";
const call=(method,...args)=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.[method])return reject(Error("UNAVAILABLE"));
 IpcSender.vault[method](...args,response=>response?.success?resolve(response.data):reject(Error("RECOVERY_FAILED")));
});
export default function RecoverySetup({onRegistered}){
 const [state,setState]=useState(null),[code,setCode]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(false),[saved,setSaved]=useState(false);
 const live=useRef(true),pending=useRef(false),input=useRef(null);
 useEffect(()=>{
  live.current=true;let active=true;
  call("identityStatus").then(value=>{if(active)setState(value);}).catch(()=>{if(active)setError(true);});
  return ()=>{active=false;live.current=false;};
 },[]);
 useEffect(()=>{if(!code)return;const timer=setTimeout(()=>setCode(""),30000);return ()=>clearTimeout(timer);},[code]);
 const run=async action=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError(false);
  try{await action();}catch{if(live.current)setError(true);}
  finally{pending.current=false;if(live.current)setBusy(false);}
 };
 if(state?.phase==="RECOVERY_CONFIRMED"&&onRegistered)return <section aria-label="서버 연결"><h3>복구 준비를 마쳤어요</h3><p>이제 현재 계정에 이 기기를 연결합니다.</p><VaultRegistration onRegistered={onRegistered}/></section>;
 return <section aria-label="기기 키와 복구 준비">
  <h3>기기 키와 복구 준비</h3>
  <p>기기를 잃어버려도 할 일을 되찾을 수 있도록 복구 자료를 보관해주세요.</p>
  {!state?<button disabled={busy} onClick={()=>run(async()=>{const value=await call("prepareIdentity");if(live.current)setState(value);})}>기기 키 준비</button>:<>
   <p>{state.recoveryStale?"다른 기기에서 키가 바뀌어 기존 복구 자료가 최신이 아닙니다. 기기 해지와 키 회전에서 새 복구 자료를 준비하세요.":state.phase==="RECOVERY_CONFIRMED"?"복구 파일·코드 검증 완료":"복구 파일·코드 확인 필요"}</p>
   <details><summary>보관함 식별 정보</summary><code>{state.fingerprint}</code></details>
   {state.phase==="RECOVERY_CONFIRMED"&&<VaultRegistration onRegistered={onRegistered}/>}
   <p>복구 코드와 암호화 파일이 모두 필요합니다. 서로 다른 안전한 곳에 보관하고 채팅이나 로그에 붙여넣지 마세요.</p>
   <button disabled={busy} onClick={()=>run(async()=>{const value=await call("recoveryCode");if(live.current)setCode(value);})}>복구 코드 보기 (30초)</button>
   {code&&<><pre style={{overflowWrap:"anywhere",whiteSpace:"pre-wrap"}}>{code}</pre><button onClick={()=>setCode("")}>코드 숨기기</button></>}
   <button disabled={busy} onClick={()=>run(async()=>{const ok=await call("exportRecovery");if(live.current)setSaved(ok===true);})}>암호화 복구 파일 저장</button>
   {saved&&<p>복구 파일을 저장했습니다. 아래에서 저장한 파일과 코드를 확인해주세요.</p>}
   <form onSubmit={event=>{event.preventDefault();const value=input.current.value;input.current.value="";setCode("");
    run(async()=>{const next=await call("confirmRecovery",value);if(live.current&&next)setState(next);});}}>
    <label htmlFor="recovery-code">보관한 복구 코드</label><PasswordField ref={input} id="recovery-code" label="복구 코드" autoComplete="off" maxLength={128} required disabled={busy}/>
    <button disabled={busy} type="submit">저장한 파일 열어 확인</button>
   </form>
  </>}
  {error&&<p role="alert">복구 준비를 완료하지 못했습니다. 코드와 파일을 확인해주세요. 기존 키는 변경하지 않았습니다.</p>}
 </section>;
}
