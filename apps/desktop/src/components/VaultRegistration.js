import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
export default function VaultRegistration(){
 const [endpoint,setEndpoint]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[result,setResult]=useState(""),[error,setError]=useState(false);
 const live=useRef(true),pending=useRef(false);
 useEffect(()=>{
  live.current=true;let active=true;
  IpcSender.vault.registrationEndpoint?.(response=>{
   if(active){if(response.success)setEndpoint(response.data);else setError(true);}
  });
  return ()=>{active=false;live.current=false;};
 },[]);
 const register=()=>{
  if(pending.current||!confirmed||!endpoint)return;
  pending.current=true;setBusy(true);setError(false);
  IpcSender.vault.registerIdentity(response=>{
   pending.current=false;if(!live.current)return;setBusy(false);
   if(response.success)setResult(response.data.phase);else setError(true);
  });
 };
 return <section aria-label="서버 보관함 연결">
  <h4>서버 보관함 연결</h4>
  <p>대상 서버: {endpoint||"확인 중…"}</p>
  <p>공개 기기 키와 서명된 보관함 정보를 등록합니다. 비밀키·복구 코드는 전송하지 않으며 기존 할 일 이관은 실행하지 않습니다.</p>
  <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>대상 서버와 등록 범위를 확인했습니다.</label>
  <button disabled={!endpoint||!confirmed||busy} onClick={register}>{busy?"확인 중…":"서버 등록·연결 확인"}</button>
  {result==="REGISTERED"&&<p role="status">등록된 기기와 서버 서명 이력을 확인했습니다. 데이터 이관은 아직 하지 않았습니다.</p>}
  {result==="PAIRING_REQUIRED"&&<p role="status">기존 보관함이 있습니다. 다른 기기의 승인 또는 복구 키로 연결해야 합니다. 기존 키는 덮어쓰지 않았습니다.</p>}
  {error&&<p role="alert">서버 연결을 확인하지 못했습니다. 서버의 E2EE API 설정과 로그인 상태를 확인해주세요. 초기화하지 말고 다시 시도하세요.</p>}
 </section>;
}
