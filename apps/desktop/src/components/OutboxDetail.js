import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
const Value=({value})=><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxWidth:320}}>{value.present?value.text:"(값 없음)"}{value.truncated?" … (일부만 표시)":""}</pre>;
export default function OutboxDetail({id,objectId}){
 const [page,setPage]=useState(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),sequence=useRef(0);
 const load=offset=>{
  const request=++sequence.current;setBusy(true);setPage(null);setError(false);
  IpcSender.vault.outboxDetail({id,objectId,offset},response=>{
   if(request!==sequence.current)return;setBusy(false);
   if(response.success)setPage(response.data);else setError(true);
  });
 };
 useEffect(()=>()=>{sequence.current++;},[]);
 return <section aria-label="미전송 내용 비교">
  <button disabled={busy} onClick={()=>load(0)}>내용 비교 열기</button>
  <button onClick={()=>{sequence.current++;setPage(null);setBusy(false);setError(false);}}>내용 숨기기</button>
  {error&&<p role="alert">항목을 조회하지 못했습니다. 동기화로 정리됐거나 잠긴 상태일 수 있습니다.</p>}
  {page&&<>
   <p>편집 기준 버전 {page.baseVersion} · 마지막으로 검증한 서버 버전 {page.currentVersion??"없음"}. 서버의 실시간 상태는 아닙니다.</p>
   {page.baseMissing&&<p>편집 전 원본이 없어 자동으로 병합할 수 없습니다.</p>}
   {page.currentMissing&&<p>로컬에 검증된 서버 항목이 없습니다.</p>}
   {page.localDeleted&&<p>이 변경은 삭제 요청입니다.</p>}
   {page.currentDeleted&&<p>검증된 서버 항목은 삭제된 상태입니다.</p>}
   <table><thead><tr><th>필드</th><th>편집 전</th><th>내 변경</th><th>검증된 서버 사본</th></tr></thead>
    <tbody>{page.fields.map(field=><tr key={field.slot}><th>{field.slot}</th><td><Value value={field.base}/></td><td><Value value={field.local}/></td><td><Value value={field.current}/></td></tr>)}</tbody>
   </table>
   {page.more&&<button disabled={busy} onClick={()=>load(page.next)}>다음 필드</button>}
  </>}
 </section>;
}
