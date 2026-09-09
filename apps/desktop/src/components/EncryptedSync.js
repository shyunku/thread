import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
export default function EncryptedSync(){
 const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),live=useRef(true),pending=useRef(false);
 useEffect(()=>{live.current=true;return ()=>{live.current=false;};},[]);
 const run=()=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError(false);setResult(null);
  IpcSender.vault.sync(response=>{pending.current=false;if(!live.current)return;setBusy(false);if(response.success)setResult(response.data);else setError(true);});
 };
 return <section aria-label="암호화 동기화 확인">
  <h3>암호화 동기화 확인</h3>
  <p>이미 이관된 서버 계정만 연결합니다. 이 버튼은 기존 계정을 이관하지 않습니다. 연결되면 보존된 암호화 미전송 변경을 재시도합니다.</p>
  <button disabled={busy} onClick={run}>{busy?"동기화 중…":"암호화 동기화 실행"}</button>
  {result?.phase==="WAITING_FOR_MIGRATION"&&<p role="status">서버 계정이 아직 E2EE로 전환되지 않았습니다. 기존 데이터는 그대로 유지합니다.</p>}
  {result?.phase==="ACTIVE"&&<p role="status">암호화 동기화 완료 · 반영 번호 {result.cursor} · 미전송 {result.pending}개 · 충돌 {result.conflicts}개</p>}
  {error&&<p role="alert">동기화를 확인하지 못했습니다. 기기 연결·키 세대·서버 상태를 확인해주세요. 초기화하지 말고 다시 시도하세요.</p>}
 </section>;
}
