import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
const Value=({value})=><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxWidth:320}}>{value.present?value.text:"(값 없음)"}{value.truncated?" … (일부만 표시)":""}</pre>;
const labels={UNCHANGED:"변경 없음",MATCHING_VALUES:"양쪽 값 같음",LOCAL_ONLY:"내 변경만 있음",REMOTE_ONLY:"서버 변경만 있음",FIELD_CONFLICT:"양쪽 변경 충돌",REVIEW_REQUIRED:"직접 확인 필요"};
export default function OutboxDetail({id,objectId}){
 const [page,setPage]=useState(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),sequence=useRef(0);
 const [ack,setAck]=useState(false),[result,setResult]=useState(null),resolving=useRef(false);
 const load=(offset,expectedRevision)=>{
  const request=++sequence.current;setBusy(true);setPage(null);setError(false);setAck(false);setResult(null);
  IpcSender.vault.outboxDetail({id,objectId,offset,...(expectedRevision?{expectedRevision}:{})},response=>{
   if(request!==sequence.current)return;setBusy(false);
   if(response.success)setPage(response.data);else setError(true);
  });
 };
 useEffect(()=>()=>{sequence.current++;},[]);
 const resolve=choice=>{
  if(!ack||!page?.canResolve||resolving.current)return;
  resolving.current=true;const request=++sequence.current;setBusy(true);setError(false);
  IpcSender.vault.resolveConflict({id,objectId,expectedRevision:page.revision,choice},response=>{
   resolving.current=false;if(request!==sequence.current)return;setBusy(false);setPage(null);setAck(false);
   if(response.success)setResult(response.data.phase);else setError(true);
  });
 };
 return <section aria-label="미전송 내용 비교">
  <button disabled={busy} onClick={()=>load(0)}>내용 비교 열기</button>
  <button onClick={()=>{sequence.current++;setPage(null);setBusy(false);setError(false);setAck(false);setResult(null);}}>내용 숨기기</button>
  {error&&<p role="alert">항목이 변경·정리됐거나 보관함이 잠겼을 수 있습니다. 잠금 해제 후 내용 비교를 처음부터 다시 열어주세요.</p>}
  {result&&<p role="status">{result==="QUEUED"?"내 변경을 새 전송 대기에 등록했습니다. 아직 서버에 전송하지 않았습니다.":"검증된 서버 사본을 선택했습니다."} 원본은 복구 자료에 보존했습니다. 목록을 다시 조회해주세요.</p>}
  {page&&<>
   <p>편집 기준 버전 {page.baseVersion} · 마지막으로 검증한 서버 버전 {page.currentVersion??"없음"}. 서버의 실시간 상태는 아닙니다.</p>
   {page.baseMissing&&<p>편집 전 원본이 없어 자동으로 병합할 수 없습니다.</p>}
   {page.currentMissing&&<p>로컬에 검증된 서버 항목이 없습니다.</p>}
   {page.localDeleted&&<p>이 변경은 삭제 요청입니다.</p>}
   {page.currentDeleted&&<p>검증된 서버 항목은 삭제된 상태입니다.</p>}
   <p>판정은 생략되지 않은 전체 값 기준입니다. 값이 같아도 내 요청의 서버 반영이 확인된 것은 아닙니다.</p>
   <table><thead><tr><th>필드</th><th>판정</th><th>편집 전</th><th>내 변경</th><th>검증된 서버 사본</th></tr></thead>
    <tbody>{page.fields.map(field=><tr key={field.slot}><th>{field.slot}</th><td>{labels[field.status]||"직접 확인 필요"}</td><td><Value value={field.base}/></td><td><Value value={field.local}/></td><td><Value value={field.current}/></td></tr>)}</tbody>
   </table>
   {page.more&&<button disabled={busy} onClick={()=>load(page.next,page.revision)}>다음 필드</button>}
   {page.canResolve&&<>
    <p>내 변경 선택은 일부 필드 병합이 아니라 해당 항목 전체 값을 선택합니다. 서버 사본 선택 시 내 변경은 복구 자료에만 보존됩니다. 다른 종속 편집이 있으면 적용하지 않습니다.</p>
    <label><input type="checkbox" checked={ack} disabled={busy} onChange={event=>setAck(event.target.checked)}/>전체 항목 선택의 영향을 확인했습니다.</label>
    <button disabled={!ack||busy} onClick={()=>resolve("local")}>내 변경을 전송 대기에 등록</button>
    <button disabled={!ack||busy} onClick={()=>resolve("current")}>검증된 서버 사본 유지</button>
   </>}
  </>}
 </section>;
}
