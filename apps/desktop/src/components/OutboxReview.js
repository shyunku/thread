import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
import OutboxDetail from "./OutboxDetail";
const labels={REVIEW_REQUIRED:"확인 필요",ACK_UNCERTAIN:"서버 반영 여부 확인 필요",QUEUED:"전송 대기"};
export default function OutboxReview(){
 const [page,setPage]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),live=useRef(true),pending=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const load=after=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError(false);
  IpcSender.vault.outboxReviews({after,limit:20},response=>{
   pending.current=false;if(!live.current)return;setBusy(false);
   if(response.success)setPage(response.data);else {setPage(null);setError(true);}
  });
 };
 return <section aria-label="미전송 보관함">
  <h3>미전송 보관함</h3>
  <p>로컬에 보존된 변경의 상태입니다. 확인만 하며 재전송하거나 삭제하지 않습니다.</p>
  <button disabled={busy} onClick={()=>load("")}>{busy?"조회 중…":"미전송 항목 확인"}</button>
  {error&&<p role="alert">조회하지 못했습니다. 보관함 잠금 상태를 확인해주세요.</p>}
  {page&&page.items.length===0&&<p role="status">이 페이지에 미전송 항목이 없습니다.</p>}
  {page?.items.map(item=><article key={item.id}>
   <h4>{labels[item.status]} · 변경 {item.objectCount}개</h4>
   <p>요청 ID: {item.id}</p>
   {item.reason==="STALE_SIGNED_REQUEST"&&<p>기기 권한 또는 키 세대 변경 후 거절된 원본입니다. 미반영이 확정된 것은 아닙니다.</p>}
   {item.reason==="OBJECT_CONFLICT"&&<p>다른 변경과 충돌하여 원본을 보존했습니다.</p>}
   <ul>{item.objects.map(object=><li key={object.id}>{object.id} · 기준 버전 {object.baseVersion} · {object.deleted?"삭제 요청":"필드 "+object.fieldCount+"개 변경"}<OutboxDetail key={item.id+":"+object.id} id={item.id} objectId={object.id}/></li>)}</ul>
   {item.moreObjects&&<p>항목이 많아 처음 20개만 표시합니다.</p>}
  </article>)}
  {page?.more&&<button disabled={busy} onClick={()=>load(page.next)}>다음 20개</button>}
  <p>서명 전 단일 충돌만 명시적으로 선택할 수 있습니다. 전송 여부가 불확실하거나 종속 변경이 있으면 원본을 보존하고 재적용하지 않습니다.</p>
 </section>;
}
