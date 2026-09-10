import {useEffect,useRef,useState} from "react";
import IpcSender from "../utils/IpcSender";
const call=(name,...args)=>new Promise((resolve,reject)=>{
 if(!IpcSender.vault?.[name])return reject(Error("UNAVAILABLE"));
 IpcSender.vault[name](...args,result=>result?.success?resolve(result.data):reject(Error("MIGRATION_FAILED")));
});
const labels={NOT_STARTED:"시작 전",PREPARING:"원본 확인 중",FROZEN:"편집 중지·원본 고정됨",UPLOADING:"암호화 업로드 중",VERIFIED:"서버 사본 복호화 검증됨",COMMITTING:"전환 결과 확인 중",ACTIVE:"서버 전환 완료",CANCELLED:"취소 확인됨"};
export default function MigrationPanel({osAvailable,onContinue}){
 const [state,setState]=useState(null),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[error,setError]=useState(false);
 const [method,setMethod]=useState(osAvailable?"os":"password"),password=useRef(null),live=useRef(true),pending=useRef(false);
 useEffect(()=>{
  live.current=true;let active=true;
  call("migrationStatus").then(value=>{if(active)setState(value);}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;live.current=false;};
 },[]);
 const run=async action=>{
  if(pending.current||!consent)return;
  pending.current=true;setBusy(true);setError(false);
  const input={confirmed:true,method,password:method==="password"?password.current?.value:undefined};
  if(password.current)password.current.value="";
  try{
   const result=await call("migration",action,input);
   if(live.current){setState(result);setConsent(false);}
  }catch{if(live.current)setError(true);}
  finally{input.password=undefined;pending.current=false;if(live.current)setBusy(false);}
 };
 const phase=state?.phase,waiting=busy||state?.busy;
 return <section aria-label="암호화 이관">
  <h3>기존 할 일 암호화 이관</h3>
  <p>배포 전에는 기존 앱을 그대로 사용하세요. 이관은 새 버전의 시작 화면에서, 복구 파일 확인과 서버 등록을 마친 뒤 진행합니다.</p>
  <p>준비를 누르면 이 계정의 기존 편집이 중지됩니다. 전환 중에는 모든 기기를 닫아두세요. 원본 DB와 미전송 변경은 보존하며 자동 삭제하거나 재전송하지 않습니다.</p>
  <p role="status">{state?labels[phase]||"상태 확인 필요":"상태 확인 중"}</p>
  {error&&<p role="alert">이관을 완료하지 못했습니다. 서버 연결·복구 확인·기기 권한을 확인하세요. 기존 앱이 열려 있었다면 종료 후 다시 시작하세요. 전환 결과가 불확실하면 초기화하지 말고 같은 단계에서 재시도하세요.</p>}
  {!["ACTIVE","CANCELLED"].includes(phase)&&<>
   <label><input type="checkbox" checked={consent} disabled={waiting} onChange={event=>setConsent(event.target.checked)}/>복구 자료를 보관했고, 기존 편집 중지와 검증 후 암호화 전환에 동의합니다.</label>
   <label>재인증 방법<select value={method} disabled={waiting} onChange={event=>setMethod(event.target.value)}>
    {osAvailable&&<option value="os">OS 인증</option>}<option value="password">보관함 비밀번호</option>
   </select></label>
   {method==="password"&&<label>보관함 비밀번호<input ref={password} type="password" autoComplete="off" maxLength={1024} disabled={waiting}/></label>}
   {["NOT_STARTED","PREPARING","FROZEN"].includes(phase)&&<button disabled={!consent||waiting} onClick={()=>run("prepare")}>원본 준비·재확인</button>}
   {["FROZEN","UPLOADING","VERIFIED","COMMITTING"].includes(phase)&&<button disabled={!consent||waiting} onClick={()=>run("transfer")}>암호화 전환·재개</button>}
   {["PREPARING","FROZEN","UPLOADING","VERIFIED","COMMITTING"].includes(phase)&&<button disabled={!consent||waiting} onClick={()=>run("cancel")}>이관 취소 요청</button>}
  </>}
  {phase==="ACTIVE"&&<p>서버 전환을 확인했습니다. 다음 단계에서 서명된 snapshot으로 이 기기를 연결합니다. 보존된 이전 변경은 별도로 검토하세요.</p>}
  {phase==="CANCELLED"&&<p>기존 원본은 유지됩니다. 취소한 시도는 재사용하지 않으며 새 이관 준비는 별도 지원이 필요합니다.</p>}
  {onContinue&&["ACTIVE","CANCELLED"].includes(phase)&&<button onClick={onContinue}>저장소 다시 확인</button>}
 </section>;
}
