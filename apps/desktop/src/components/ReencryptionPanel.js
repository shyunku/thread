import {useRef,useState,useEffect} from "react";
import IpcSender from "../utils/IpcSender";
export default function ReencryptionPanel(){
 const [status,setStatus]=useState(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const live=useRef(true),pending=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const run=action=>{
  if(pending.current||(action!=="status"&&!consent))return;
  pending.current=true;setBusy(true);setError(false);
  const finish=result=>{pending.current=false;if(!live.current)return;setBusy(false);if(result?.success){setStatus(result.data);setConsent(false);}else setError(true);};
  if(!IpcSender.vault?.reencryption)return finish(null);
  IpcSender.vault.reencryption(action,{confirmed:consent},finish);
 };
 return <section aria-label="기존 데이터 재암호화">
  <h3>기존 데이터 재암호화</h3>
  <p>키 회전 뒤 현재 데이터를 새 키로 다시 전송합니다. 시작에 동의하면 평상시 동기화가 최대 100개씩 자동 진행하며 실제 서명된 전송 확인 뒤 다음 묶음으로 넘어갑니다. 충돌·키 변경 시 일시 중지하며 수동 재개할 수 있습니다.</p>
  <p>과거 키는 삭제하지 않습니다. 이전 백업·미전송 변경·서버 이력을 읽는 데 필요하며, 과거에 유출된 사본을 회수하지는 못합니다. 초기화나 원본 삭제 기능은 제공하지 않습니다.</p>
  <button disabled={busy} onClick={()=>run("status")}>재암호화 상태 확인</button>
  {status&&<p role="status">키 세대 {status.generation} · 확인 {status.count}개 · {status.phase}</p>}
  {error&&<p role="alert">진행하지 못했습니다. 동기화와 미전송 충돌을 확인하세요. 키 세대가 바뀌었다면 원본 대기를 처리한 뒤 새 작업으로 시작하세요.</p>}
  <label><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>과거 키·원본을 유지하며 재암호화하는 데 동의합니다.</label>
  <button disabled={busy||!consent} onClick={()=>run("start")}>재암호화 작업 시작</button>
  <button disabled={busy||!consent||!status||["DONE","CANCELLED"].includes(status.phase)} onClick={()=>run("step")}>전송 확인·다음 묶음 등록</button>
  <button disabled={busy||!consent||!status||["DONE","CANCELLED"].includes(status.phase)} onClick={()=>run("cancel")}>작업 중지·이미 등록한 대기는 유지</button>
 </section>;
}
