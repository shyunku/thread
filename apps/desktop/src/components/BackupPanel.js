import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
const call=(action,input={})=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.backup)return reject(Error("UNAVAILABLE"));
 IpcSender.vault.backup(action,input,result=>result?.success?resolve(result.data):reject(Error("BACKUP_FAILED")));
});
export default function BackupPanel({osAvailable}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(false),[consent,setConsent]=useState(false),[method,setMethod]=useState(osAvailable?"os":"password");
 const [code,setCode]=useState(""),[result,setResult]=useState(null),[copies,setCopies]=useState([]),[page,setPage]=useState(null);
 const password=useRef(null),codeInput=useRef(null),live=useRef(true),pending=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{if(!code)return;const timer=setTimeout(()=>setCode(""),30000);const hide=()=>setCode("");window.addEventListener("blur",hide);return()=>{clearTimeout(timer);window.removeEventListener("blur",hide);};},[code]);
 const run=async(action,extra={})=>{
  if(pending.current||(["export","restore","apply"].includes(action)&&!consent))return;
  pending.current=true;setBusy(true);setError(false);setPage(null);
  const input={...extra,confirmed:consent,method,password:password.current?.value,code:codeInput.current?.value};
  if(password.current)password.current.value="";
  if(codeInput.current)codeInput.current.value="";
  try{
   const value=await call(action,input);if(!live.current)return;
   if(action==="code")setCode(value);
   else if(action==="list")setCopies(value);
   else if(action==="review")setPage({...value,id:extra.id});
   else{setResult(value);setConsent(false);setCode("");}
  }catch{if(live.current)setError(true);}
  finally{input.password=undefined;input.code=undefined;pending.current=false;if(live.current)setBusy(false);}
 };
 return <section aria-label="암호화 데이터 백업">
  <h3>암호화 데이터 백업</h3>
  <p>복구 키 파일과 달리 할 일·미전송 변경을 포함한 데이터 사본입니다. 백업 코드와 파일을 따로 보관하세요. 내보내기 후 반드시 가져오기로 코드와 파일을 확인하세요.</p>
  <p>가져오기는 별도 암호화 검토 사본을 만듭니다. 현재 할 일·기기 키·미전송 변경을 덮어쓰거나 이전 요청을 재전송하지 않습니다. 원본 키와 요청은 사본 안에 보존하고, 여기서는 제목·메모만 보여줍니다.</p>
  {error&&<p role="alert">백업을 처리하지 못했습니다. 코드·파일·권한·잠금 상태를 확인하세요. 기존 파일은 덮어쓰지 않습니다.</p>}
  {result&&<p role="status">{result.phase==="EXPORTED"?"암호화 백업 저장 완료":result.phase==="COPIES_QUEUED"?"새 항목 사본 전송 대기 등록":"복구 사본 검토 대기"} · {result.count}개 레코드</p>}
  <button disabled={busy} onClick={()=>run("code")}>새 백업 코드 생성 (30초)</button>
  {code&&<pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{code}</pre>}
  <label>보관한 백업 코드<input ref={codeInput} type="password" autoComplete="off" maxLength={128} disabled={busy}/></label>
  <label><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>코드를 안전하게 보관하며 가져온 사본은 자동 적용되지 않음을 확인했습니다.</label>
  <label>백업 재인증<select value={method} disabled={busy} onChange={event=>setMethod(event.target.value)}>{osAvailable&&<option value="os">OS 인증</option>}<option value="password">보관함 비밀번호</option></select></label>
  {method==="password"&&<label>백업용 보관함 비밀번호<input ref={password} type="password" autoComplete="off" maxLength={1024} disabled={busy}/></label>}
  <button disabled={busy||!consent} onClick={()=>run("export")}>암호화 백업 저장</button>
  <button disabled={busy||!consent} onClick={()=>run("restore")}>백업을 별도 사본으로 가져오기</button>
  <button disabled={busy} onClick={()=>run("list")}>보존된 복구 사본 목록</button>
  {copies.map((copy,index)=><button key={copy.id} disabled={busy} onClick={()=>run("review",{id:copy.id})}>사본 {index+1} 검토{copy.phase==="STAGED"?" (완료 여부 확인)":""}</button>)}
  {page&&<div>
   <p>새 사본으로 복원하면 이 백업의 현재 할 일·날짜·반복 설정·카테고리·하위 항목을 새로운 ID로 추가합니다(최대 1,000개 객체). 기존 항목과 중복될 수 있습니다. 옛 기기 ID·서명 요청은 재사용하지 않습니다.</p>
   <button disabled={busy||!consent} onClick={()=>run("apply",{id:page.id})}>이 백업의 항목을 새 사본으로 복원</button>
   {page.items.map(item=><article key={item.id}><span>{item.bucket==="visible"?"로컬 최종 보기":"서버 확인 사본"} · </span><strong>{item.content.title||"(제목 없음)"}</strong><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{item.content.memo}</pre>{item.deleted&&<span>삭제된 항목</span>}</article>)}
   {page.next&&<button disabled={busy} onClick={()=>run("review",{id:page.id,after:page.next})}>다음 복구 페이지</button>}</div>}
 </section>;
}
