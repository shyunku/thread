import {useEffect,useState} from "react";
import "./LegacyRecovery.scss";
const reasons={
 FIELD_CONFLICT:"같은 필드가 다른 기기에서도 변경되었습니다.",
 DELETED_OR_MISSING:"현재 항목이 삭제되었거나 없습니다.",
 ACK_OR_REJECTION_REVIEW:"이전 서버의 처리 결과를 확인해야 합니다.",
 DEPENDENT_EDIT:"앞선 변경과 함께 확인해야 합니다.",
 LOCAL_PENDING_CONFLICT:"이 기기에 다른 미전송 변경이 있습니다.",
};
// Mount only inside an unlocked, account-scoped vault screen.
export default function LegacyRecovery({sessionKey,unlocked,intakeId,loadPage}){
 const [state,setState]=useState(null),[offset,setOffset]=useState(0);
 const scope=JSON.stringify([sessionKey,intakeId,unlocked]);
 useEffect(()=>{setOffset(0);},[scope]);
 useEffect(()=>{
  let active=true;setState(null);
  if(unlocked)Promise.resolve().then(()=>loadPage({id:intakeId,offset,limit:20})).then(page=>{
   if(active)setState({scope,offset,page});
  }).catch(()=>{if(active)setState({scope,offset,error:true});});
  return ()=>{active=false;};
 },[scope,offset,unlocked,intakeId,loadPage]);
 if(!unlocked)return <p>보관함 잠금을 해제하면 복구 자료를 확인할 수 있어요.</p>;
 const current=state?.scope===scope&&state.offset===offset?state:null;
 return <section className="legacy-recovery" aria-label="이전 기기 변경 검토">
  <h2>이전 기기 변경 검토</h2>
  <p>원본은 보존되어 있어요. 이 화면을 열거나 닫아도 변경을 전송하거나 삭제하지 않습니다.</p>
  <p>제목과 메모는 각각 최대 4,096자까지 미리 표시합니다. 그 밖의 변경과 전체 원본도 보존되어 있습니다.</p>
  {current?.error?<p role="alert">복구 자료를 읽지 못했습니다. 보관함 상태를 확인해주세요.</p>:!current?<p role="status">확인 중…</p>:<>
   <p>검토할 변경 {current.page.total}개</p>
   {current.page.items.map(item=><article key={item.changeId}>
    <h3>{item.local.title||item.remote.title||item.original.title||"제목 없는 변경"}</h3>
    <p>{reasons[item.reason]||"자동으로 적용할 수 없는 변경입니다."}</p>
    {item.deleted&&<p>현재 항목 없음 · 자동 복원하지 않습니다.</p>}
    <div className="legacy-recovery-columns">{[["원래 내용",item.original],["이전 기기 수정",item.local],["현재 내용",item.remote]].map(([label,fields])=><div key={label}>
     <h4>{label}</h4>{["title","memo"].map(field=><div key={field}><span>{field==="title"?"제목":"메모"}</span><pre>{fields[field]??"변경 또는 자료 없음"}</pre></div>)}
    </div>)}</div>
   </article>)}
   <button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>이전</button>
   <button disabled={current.page.next===null} onClick={()=>setOffset(current.page.next)}>다음</button>
  </>}
 </section>;
}
