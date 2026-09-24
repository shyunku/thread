import {useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";

export default function NewAccountActivation({onContinue}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(false),pending=useRef(false);
 const activate=()=>{
  if(pending.current)return;
  pending.current=true;setBusy(true);setError(false);
  IpcSender.vault.activateEmpty(result=>{
   pending.current=false;setBusy(false);
   if(result?.success&&result.data?.phase==="ACTIVE")onContinue?.();
   else setError(true);
  });
 };
 return <section aria-label="새 데이터 시작">
  <h3>암호화된 데이터 시작</h3>
  <p>복구 자료와 이 기기의 연결을 마쳤어요. 이제 빈 암호화 저장소를 시작합니다. 옮길 기존 데이터는 없습니다.</p>
  <button type="button" disabled={busy} onClick={activate}>{busy?"확인 중…":"시작하기"}</button>
  {error&&<p role="alert">새 데이터 저장소를 시작하지 못했어요. 연결을 확인하고 다시 시도해주세요.</p>}
 </section>;
}
