import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
export default function DevicePairing({osAvailable=false}){
 const [pin,setPin]=useState(""),[request,setRequest]=useState(null),[preview,setPreview]=useState(null),[confirmed,setConfirmed]=useState(false);
 const [method,setMethod]=useState("password"),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(false);
 const mounted=useRef(true),pending=useRef(false),password=useRef(null);
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
 const run=(action,input,done)=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError(false);setMessage("");
  IpcSender.vault.pairing(action,input,response=>{
   pending.current=false;if(!mounted.current)return;setBusy(false);
   if(response.success)done(response.data);else setError(true);
  });
 };
 return <section aria-label="파일로 기기 연결">
  <h3>파일로 기기 연결</h3>
  <p>두 기기에 같은 계정으로 로그인해야 합니다. 보관함 지문과 요청 지문을 직접 비교하세요. 요청은 10분 후 만료됩니다.</p>
  <h4>새 기기에서</h4>
  <label>기존 기기의 보관함 지문<input value={pin} maxLength={64} disabled={busy} onChange={event=>setPin(event.target.value.trim())}/></label>
  <button disabled={busy||!/^[a-f0-9]{64}$/.test(pin)} onClick={()=>run("request",{fingerprint:pin},value=>{setRequest(value);setMessage(value.saved?"연결 요청 파일을 저장했습니다. 기존 기기로 옮겨주세요.":"파일 저장을 취소했습니다. 같은 요청으로 다시 저장할 수 있습니다.");})}>연결 요청 파일 만들기</button>
  {request&&<p>요청 지문: <code>{request.fingerprint}</code></p>}
  <button disabled={busy} onClick={()=>run("accept",{},value=>{if(value?.phase==="PAIRED")setMessage("기기 키 연결을 완료했습니다. 기존 데이터 이관·동기화는 아직 실행하지 않았습니다.");})}>승인받은 키 전달 파일 열기</button>
  <h4>기존 기기에서</h4>
  <button disabled={busy} onClick={()=>run("preview",{},value=>{setPreview(value);setConfirmed(false);})}>연결 요청 파일 열기</button>
  {preview&&<>
   <p>요청 지문: <code>{preview.fingerprint}</code></p><p>권한: {preview.role==="read"?"조회만":"조회·편집"} · 만료: {new Date(preview.expiresAt).toLocaleString()}</p>
   <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>새 기기에 표시된 요청 지문과 동일함을 확인했습니다.</label>
   <label>승인 재인증<select value={method} disabled={busy} onChange={event=>{if(password.current)password.current.value="";setMethod(event.target.value);}}>
    <option value="password">보관함 비밀번호</option><option value="os" disabled={!osAvailable}>Windows Hello / Touch ID</option>
   </select></label>
   {method==="password"&&<label>승인용 보관함 비밀번호<input ref={password} type="password" maxLength={256} autoComplete="current-password" disabled={busy}/></label>}
   <button disabled={busy||!confirmed} onClick={()=>{const value=password.current?.value;if(password.current)password.current.value="";
    run("approve",{requestId:preview.requestId,fingerprint:preview.fingerprint,method,password:value},result=>setMessage(result.saved?"승인된 키 전달 파일을 저장했습니다. 새 기기로 옮겨주세요.":"서버 승인은 완료됐지만 파일 저장을 취소했습니다. 같은 요청을 다시 승인해 저장하세요."));}}>재인증 후 승인·파일 저장</button>
  </>}
  {message&&<p role="status">{message}</p>}
  {error&&<p role="alert">기기 연결을 완료하지 못했습니다. 지문·요청 만료·로그인·재인증을 확인해주세요. 기존 키는 삭제하지 않았습니다.</p>}
 </section>;
}
