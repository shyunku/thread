import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
export default function GroupConflict(){
 const [page,setPage]=useState(null),[busy,setBusy]=useState(false),[ack,setAck]=useState(false),[message,setMessage]=useState("");
 const sequence=useRef(0),pending=useRef(false);
 useEffect(()=>()=>{sequence.current++;},[]);
 const request=(action,input={})=>{
  if(pending.current||(action==="resolve"&&(!ack||!page?.canResolve)))return;
  pending.current=true;const ticket=++sequence.current;setBusy(true);setMessage("");
  if(!IpcSender.vault?.groupConflict){pending.current=false;setBusy(false);setMessage("현재 사용할 수 없습니다.");return;}
  IpcSender.vault.groupConflict(action,input,response=>{
   pending.current=false;if(ticket!==sequence.current)return;setBusy(false);setAck(false);
   if(!response.success){setPage(null);setMessage("비교 내용이 바뀌었거나 종속 관계를 유지할 수 없습니다. 원본은 보존했습니다. 다시 동기화 후 확인하세요.");return;}
   if(action==="review")setPage(response.data);
   else{setPage(null);setMessage("전체 원본을 암호화 복구 자료로 보존했습니다. 선택한 내용은 아직 서버 전송 완료가 아닙니다. 동기화를 실행해 확인하세요.");}
  });
 };
 return <section aria-label="복수 변경 복구">
  <h3>복수·종속 변경 함께 검토</h3>
  <button disabled={busy} onClick={()=>request("review")}>전체 전송 대기 비교</button>
  <button onClick={()=>{sequence.current++;setPage(null);setAck(false);setMessage("");setBusy(false);}}>전체 내용 숨기기</button>
  {message&&<p role="status">{message}</p>}
  {page&&<>
   <p>대기 요청 {page.requests}개 · 항목 {page.objects}개. 각 항목의 최종 로컬 값과 마지막 검증 사본입니다. 긴 값은 일부만 표시합니다.</p>
   {page.reason==="ROTATION_AND_SYNC_REQUIRED"&&<p>아직 유효한 서명 요청은 다른 내용으로 재전송할 수 없습니다. 원본 반영 확인을 먼저 시도하고, 복구가 필요하면 키 회전과 암호화 동기화 후 다시 검토하세요.</p>}
   {page.reason==="GROUP_LIMIT"&&<p>100개 항목을 넘는 복구는 이 화면에서 실행하지 않습니다. 원본은 그대로 보존합니다.</p>}
   <table><thead><tr><th>항목</th><th>최종 로컬 값</th><th>검증된 서버 사본</th></tr></thead><tbody>{page.items.map(item=><tr key={item.id}><th>{item.id}</th>{["local","current"].map(side=><td key={side}><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxWidth:300}}>{item[side].missing?"항목 없음":item[side].deleted?"삭제":item[side].text}{item[side].truncated?" … (일부 표시)":""}</pre></td>)}</tr>)}</tbody></table>
   {page.canResolve&&<>
    <p>전체 대기 요청을 함께 선택합니다. 로컬 값 선택은 필드 병합이 아닌 새 요청이며, 과거 요청의 반영 여부를 확정하지 않습니다. 원본 서명과 값은 복구 자료에 남습니다.</p>
    <label><input type="checkbox" disabled={busy} checked={ack} onChange={event=>setAck(event.target.checked)}/>전체 항목·삭제·종속 변경의 영향을 확인했습니다.</label>
    <button disabled={busy||!ack} onClick={()=>request("resolve",{confirmed:true,choice:"local",expectedRevision:page.revision})}>전체 로컬 값으로 새 요청 만들기</button>
    <button disabled={busy||!ack} onClick={()=>request("resolve",{confirmed:true,choice:"current",expectedRevision:page.revision})}>전체 검증 사본 유지</button>
   </>}
  </>}
 </section>;
}
