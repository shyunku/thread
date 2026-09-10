import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
const call=(action,input={})=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.rotation)return reject(Error("UNAVAILABLE"));
 IpcSender.vault.rotation(action,input,result=>result?.success?resolve(result.data):reject(Error("ROTATION_FAILED")));
});
export default function RotationPanel({osAvailable}){
 const [state,setState]=useState(null),[devices,setDevices]=useState([]),[remove,setRemove]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const [consent,setConsent]=useState(false),[code,setCode]=useState(""),[method,setMethod]=useState(osAvailable?"os":"password");
 const password=useRef(null),confirmation=useRef(null),live=useRef(true),pending=useRef(false);
 useEffect(()=>{live.current=true;let active=true;call("status").then(value=>{if(active)setState(value);}).catch(()=>{if(active)setError(true);});return()=>{active=false;live.current=false;};},[]);
 useEffect(()=>{if(!code)return;const timer=setTimeout(()=>setCode(""),30000);return()=>clearTimeout(timer);},[code]);
 const run=async(action,input={})=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError(false);
  if(["prepare","commit"].includes(action)){
   if(!consent){pending.current=false;setBusy(false);return;}
   input={...input,confirmed:true,method,password:password.current?.value};
   if(password.current)password.current.value="";
  }
  try{
   const result=await call(action,input);
   if(!live.current)return;
   if(action==="devices")setDevices(result);
   else if(action==="code")setCode(result);
   else if(result&&action!=="export"){setState(result);setCode("");setConsent(false);setRemove([]);}
  }catch{if(live.current)setError(true);}
  finally{input.password=undefined;input.code=undefined;pending.current=false;if(live.current)setBusy(false);}
 };
 const phase=state?.phase,prepared=["RECOVERY_UNCONFIRMED","RECOVERY_CONFIRMED","COMMITTING"].includes(phase);
 return <section aria-label="기기 해지와 키 회전">
  <h3>기기 해지와 키 회전</h3>
  <p>해지한 기기는 앞으로 바뀐 키를 받지 못합니다. 이미 내려받은 사본은 회수할 수 없습니다. 회전 시 복구 코드도 바뀌므로 새 파일과 코드를 먼저 확인해야 합니다.</p>
  <p role="status">{phase==="ACTIVE"?"키 회전 확인 완료":phase==="COMMITTING"?"서버 결과 재확인 필요":phase==="RECOVERY_CONFIRMED"?"새 복구 자료 검증 완료":phase==="RECOVERY_UNCONFIRMED"?"새 복구 자료 보관·확인 필요":"회전 준비 전"}</p>
  {error&&<p role="alert">처리하지 못했습니다. 권한·연결·복구 파일을 확인하세요. 전송 후 오류라면 새로 준비하지 말고 결과 확인을 다시 요청하세요.</p>}
  {!prepared&&<>
   <button disabled={busy} onClick={()=>run("devices")}>기기 목록 확인</button>
   {devices.map(device=><label key={device.id}><input type="checkbox" disabled={busy||device.own} checked={remove.includes(device.id)} onChange={event=>setRemove(old=>event.target.checked?[...old,device.id]:old.filter(id=>id!==device.id))}/>{device.own?"현재 기기":device.role==="read"?"조회 기기":"연결 기기"} · {device.id} {device.own?"(유지)":"(선택 시 해지)"}</label>)}
  </>}
  <label><input type="checkbox" disabled={busy} checked={consent} onChange={event=>setConsent(event.target.checked)}/>기기 권한·키·복구 코드 변경을 이해했고 새 복구 자료를 안전하게 보관하겠습니다.</label>
  <label>회전 재인증<select disabled={busy} value={method} onChange={event=>setMethod(event.target.value)}>{osAvailable&&<option value="os">OS 인증</option>}<option value="password">보관함 비밀번호</option></select></label>
  {method==="password"&&<label>회전용 보관함 비밀번호<input ref={password} type="password" autoComplete="off" maxLength={1024} disabled={busy}/></label>}
  {!prepared&&<button disabled={busy||!consent||!devices.length} onClick={()=>run("prepare",{remove})}>새 키·복구 자료 준비</button>}
  {prepared&&<>
   <button disabled={busy} onClick={()=>run("code")}>새 복구 코드 보기 (30초)</button>
   {code&&<pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{code}</pre>}
   <button disabled={busy} onClick={()=>run("export")}>새 복구 파일 저장</button>
   {phase!=="COMMITTING"&&<form onSubmit={event=>{event.preventDefault();const value=confirmation.current.value;confirmation.current.value="";setCode("");void run("confirm",{code:value});}}>
    <label>새 복구 코드<input ref={confirmation} type="password" autoComplete="off" maxLength={128} required disabled={busy}/></label>
    <button disabled={busy}>저장한 새 파일 열어 확인</button>
   </form>}
   {["RECOVERY_CONFIRMED","COMMITTING"].includes(phase)&&<button disabled={busy||!consent} onClick={()=>run("commit")}>키 회전 적용·결과 확인</button>}
   {phase!=="COMMITTING"&&<button disabled={busy} onClick={()=>run("cancel")}>미전송 회전 취소</button>}
  </>}
 </section>;
}
