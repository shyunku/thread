import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
const call=(action,input={})=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.lostRecovery)return reject(Error("UNAVAILABLE"));
 IpcSender.vault.lostRecovery(action,input,response=>response?.success?resolve(response.data):reject(Error("RECOVERY_FAILED")));
});
export default function LostRecoveryPanel({osAvailable,onContinue}){
 const [state,setState]=useState(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),[consent,setConsent]=useState(false);
 const [method,setMethod]=useState(osAvailable?"os":"password"),[code,setCode]=useState("");
 const password=useRef(null),inputCode=useRef(null),live=useRef(true),pending=useRef(false);
 useEffect(()=>{let active=true;live.current=true;call("status").then(value=>{if(active){setState(value);setReady(true);}}).catch(()=>{if(active)setError(true);});return()=>{active=false;live.current=false;};},[]);
 useEffect(()=>{if(!code)return;const timer=setTimeout(()=>setCode(""),30000);const hide=()=>setCode("");window.addEventListener("blur",hide);return()=>{clearTimeout(timer);window.removeEventListener("blur",hide);};},[code]);
 const run=async action=>{
  if(pending.current||(["prepare","commit"].includes(action)&&!consent))return;
  pending.current=true;setBusy(true);setError(false);
  const input={confirmed:consent,method,password:password.current?.value,code:inputCode.current?.value};
  if(password.current)password.current.value="";
  if(inputCode.current)inputCode.current.value="";
  setCode("");
  try{
   const result=await call(action,input);if(!live.current)return;
   if(action==="code")setCode(result);
   else if(result&&action!=="export"){setState(result);setConsent(false);}
  }catch{if(live.current)setError(true);}
  finally{input.password=undefined;input.code=undefined;pending.current=false;if(live.current)setBusy(false);}
 };
 const phase=state?.phase,prepared=["RECOVERY_UNCONFIRMED","RECOVERY_CONFIRMED","COMMITTING"].includes(phase);
 return <section aria-label="모든 기기 분실 복구">
  <h3>모든 기기를 잃었나요?</h3>
  <p>기존 복구 파일과 코드로 새 PC를 승인합니다. 새 로컬 보관함을 만든 뒤 기기 키 준비 대신 이 메뉴를 사용하세요. 기존 identity가 있는 보관함은 덮어쓰지 않습니다.</p>
  <p>적용하면 이전 모든 기기의 권한과 복구 코드가 바뀝니다. 이미 내려받은 사본은 회수할 수 없고, 서버에 전송하지 않은 변경은 별도 백업이 필요합니다.</p>
  <p>이관 중 조정 PC를 잃었다면 해당 이관을 취소하고 새 기기로 다시 준비합니다. 기존 원본은 유지되며, 취소된 이관의 임시 암호문만 정리됩니다.</p>
  <p role="status">{phase==="ACTIVE"?"복구 권한 확인 완료":phase==="COMMITTING"?"서버 결과 재확인 필요":phase==="RECOVERY_CONFIRMED"?"새 복구 자료 확인 완료":prepared?"새 복구 자료 보관 필요":"복구 준비 전"}</p>
  {error&&<p role="alert">복구하지 못했습니다. 최신 복구 파일·코드, 빈 로컬 보관함, 연결을 확인하세요. 서버가 응답하지 않았다면 초기화하지 말고 같은 요청의 결과를 다시 확인하세요.</p>}
  {phase!=="ACTIVE"&&<>
   <label><input type="checkbox" checked={consent} disabled={!ready||busy} onChange={event=>setConsent(event.target.checked)}/>이전 기기를 모두 해지하고 새 복구 자료를 보관하는 데 동의합니다.</label>
   <label>분실 복구 재인증<select value={method} disabled={busy} onChange={event=>setMethod(event.target.value)}>{osAvailable&&<option value="os">OS 인증</option>}<option value="password">보관함 비밀번호</option></select></label>
   {method==="password"&&<label>분실 복구용 보관함 비밀번호<input ref={password} type="password" autoComplete="off" maxLength={1024} disabled={busy}/></label>}
   {phase!=="COMMITTING"&&<label>{prepared?"새 복구 코드":"기존 복구 코드"}<input ref={inputCode} type="password" autoComplete="off" maxLength={128} disabled={busy}/></label>}
   {!prepared&&<button disabled={!ready||busy||!consent} onClick={()=>run("prepare")}>기존 파일 열어 분실 복구 준비</button>}
   {prepared&&<>
    <button disabled={busy} onClick={()=>run("code")}>새 분실 복구 코드 보기 (30초)</button>
    {code&&<pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{code}</pre>}
    <button disabled={busy} onClick={()=>run("export")}>새 분실 복구 파일 저장</button>
    {phase!=="COMMITTING"&&<button disabled={busy} onClick={()=>run("confirm")}>새 파일·코드 확인</button>}
    {["RECOVERY_CONFIRMED","COMMITTING"].includes(phase)&&<button disabled={busy||!consent} onClick={()=>run("commit")}>이전 기기 해지·복구 결과 확인</button>}
    {phase!=="COMMITTING"&&<button disabled={busy} onClick={()=>run("cancel")}>미전송 분실 복구 취소</button>}
   </>}
  </>}
  {phase==="ACTIVE"&&onContinue&&<button onClick={onContinue}>복구된 저장소 다시 연결</button>}
 </section>;
}
