import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
export default function VaultRegistration({onRegistered,newAccount=false}){
 const [endpoint,setEndpoint]=useState(""),[busy,setBusy]=useState(false),[result,setResult]=useState(""),[error,setError]=useState(false);
 const live=useRef(true),pending=useRef(false);
 useEffect(()=>{
  live.current=true;let active=true;
  IpcSender.vault.registrationEndpoint?.(response=>{
   if(active){if(response.success)setEndpoint(response.data);else setError(true);}
  });
  return ()=>{active=false;live.current=false;};
 },[]);
 const register=()=>{
  if(pending.current||!endpoint)return;
  pending.current=true;setBusy(true);setError(false);
  IpcSender.vault.registerIdentity(response=>{
   pending.current=false;if(!live.current)return;setBusy(false);
    if(response.success){setResult(response.data.phase);if(response.data.phase==="REGISTERED")onRegistered?.();}else setError(true);
  });
 };
 return <section aria-label="서버 데이터 연결">
  <h4>계정 등록 최종 확인</h4>
  <p>이 기기의 공개 연결 정보만 등록합니다. 복구 코드와 데이터는 전송하지 않아요.</p>
  <button disabled={!endpoint||busy} onClick={register}>{busy?"확인 중…":"등록 확인"}</button>
  {result==="REGISTERED"&&<p role="status">{newAccount?"서버 연결을 확인했어요. 다음 단계에서 빈 암호화 저장소를 시작합니다.":"서버 연결을 확인했어요. 기존 데이터 이동은 아직 시작하지 않았습니다."}</p>}
  {result==="PAIRING_REQUIRED"&&<p role="status">이미 연결된 데이터가 있어요. 기존 기기에서 승인하거나 복구 코드와 파일로 연결해주세요. 기존 연결 정보는 덮어쓰지 않았습니다.</p>}
  {error&&<p role="alert">서버 연결을 확인하지 못했습니다. 서버의 E2EE API 설정과 로그인 상태를 확인해주세요. 초기화하지 말고 다시 시도하세요.</p>}
 </section>;
}
