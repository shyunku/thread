import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
const call=(action,input)=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.legacyManual)return reject(Error("UNAVAILABLE"));
 IpcSender.vault.legacyManual(action,input,result=>result?.success?resolve(result.data):reject(Error("REVIEW_FAILED")));
});
export default function LegacyStructureReview({intakeId}){
 const [page,setPage]=useState(null),[selected,setSelected]=useState([]),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),[result,setResult]=useState(null);
 const live=useRef(true),pending=useRef(false),revision=useRef(null);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const load=async offset=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError(false);
  try{
   const value=await call("review",{id:intakeId,offset});if(!live.current)return;
   if(revision.current!==value.revision){setSelected([]);setConsent(false);}
   revision.current=value.revision;setPage({...value,offset});
  }catch{if(live.current)setError(true);}
  finally{pending.current=false;if(live.current)setBusy(false);}
 };
 const resolve=async choice=>{
  if(!consent||!selected.length||pending.current)return;pending.current=true;setBusy(true);setError(false);
  try{
   const value=await call("resolve",{id:intakeId,changeIds:selected,choice,expectedRevision:page.revision,confirmed:true});
   if(live.current){setResult(value);setSelected([]);setConsent(false);setPage(null);revision.current=null;}
  }catch{if(live.current)setError(true);}
  finally{pending.current=false;if(live.current)setBusy(false);}
 };
 return <section aria-label="이전 구조 변경 선택 복구">
  <h3>이전 구조 변경 선택 복구</h3>
  <p>선택한 변경을 현재 데이터에 새로운 의도로 적용합니다. 예전 서버에서 처리되지 않았다는 뜻은 아닙니다. 삭제·반복 완료를 다시 적용할 수 있으므로 관련 변경을 순서대로 함께 확인하세요.</p>
  <p>원본은 보존합니다. 최대 100개씩 선택하며, 다른 미전송 변경이 있거나 참조가 없으면 적용하지 않습니다. 현재 내용 유지는 선택한 원본을 보관하되 재전송하지 않습니다.</p>
  <button disabled={busy} onClick={()=>load(0)}>구조 변경 검토 불러오기</button>
  {error&&<p role="alert">처리하지 못했습니다. 변경된 상태를 다시 불러오거나 관련 부모 항목·미전송 변경을 확인하세요. 원본과 현재 데이터는 보존됩니다.</p>}
  {result&&<p role="status">{result.count}개 검토 완료 · {result.phase==="QUEUED"?"새 전송 대기 등록":"현재 내용 유지"}</p>}
  {page&&<>
   <p>검토 대상 {page.total}개 · 선택 {selected.length}개</p>
   {page.items.map(item=><article key={item.changeId}>
    <label><input type="checkbox" disabled={busy||(!selected.includes(item.changeId)&&selected.length>=100)} checked={selected.includes(item.changeId)} onChange={event=>{setConsent(false);setSelected(old=>event.target.checked?[...old,item.changeId]:old.filter(id=>id!==item.changeId));}}/>변경 {item.changeId}</label>
    <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{item.unsupported?"지원하지 않는 원본: 현재 내용 유지 가능":item.text}</pre>
    {item.truncated&&<p>긴 내용은 일부만 표시됩니다. 적용 전 원본 검토가 필요합니다.</p>}
   </article>)}
   <button disabled={busy||page.offset===0} onClick={()=>load(Math.max(0,page.offset-20))}>이전 구조 변경</button>
   <button disabled={busy||page.next===null} onClick={()=>load(page.next)}>다음 구조 변경</button>
   <label><input type="checkbox" disabled={busy} checked={consent} onChange={event=>setConsent(event.target.checked)}/>선택한 변경의 영향과 원본 보존을 확인했습니다.</label>
   <button disabled={busy||!consent||!selected.length||!page.canApply} onClick={()=>resolve("local")}>선택한 변경을 새 의도로 적용</button>
   <button disabled={busy||!consent||!selected.length} onClick={()=>resolve("current")}>현재 내용 유지·원본 보관</button>
  </>}
 </section>;
}
