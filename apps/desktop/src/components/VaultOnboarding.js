import {useState} from "react";
import RecoverySetup from "./RecoverySetup";
import MigrationPanel from "./MigrationPanel";
import DevicePairing from "./DevicePairing";
import LostRecoveryPanel from "./LostRecoveryPanel";
export default function VaultOnboarding({osAvailable,onContinue,connectionOnly=false}){
 const [step,setStep]=useState(connectionOnly?"connect":"recovery");
 return <div className="vault-onboarding">
  <ol className="vault-steps" aria-label="v3 준비 단계"><li>1. 잠금 설정 완료</li><li aria-current={step!=="migration"?"step":undefined}>2. 복구·연결</li><li aria-current={step==="migration"?"step":undefined}>3. 할 일 이전</li></ol>
  {step==="recovery"&&<RecoverySetup onRegistered={()=>setStep("migration")}/>}
  {step==="migration"&&<MigrationPanel osAvailable={osAvailable} onContinue={onContinue}/>}
  {step==="connect"&&<><DevicePairing osAvailable={osAvailable}/><button type="button" onClick={onContinue}>연결 확인 후 계속</button></>}
  {step==="recover"&&<LostRecoveryPanel osAvailable={osAvailable} onContinue={onContinue}/>}
  <details className="vault-other-options"><summary>다른 방법으로 연결</summary><div className="vault-actions">
   {!connectionOnly&&<button onClick={()=>setStep("recovery")}>복구 자료 준비</button>}
   <button onClick={()=>setStep("connect")}>기존 기기의 QR·파일로 연결</button><button onClick={()=>setStep("recover")}>복구 자료로 연결</button>
  </div></details>
 </div>;
}
