import {useEffect,useState} from "react";
import RecoverySetup from "./RecoverySetup";
import MigrationPanel from "./MigrationPanel";
import DevicePairing from "./DevicePairing";
import LostRecoveryPanel from "./LostRecoveryPanel";
import NewAccountActivation from "./NewAccountActivation";
import {VscChevronRight} from "react-icons/vsc";
export default function VaultOnboarding({osAvailable,onContinue,connectionOnly=false,newAccount=false,onStepChange}){
 const [step,setStep]=useState(connectionOnly?"connect":"recovery");
 useEffect(()=>onStepChange?.(step),[step,onStepChange]);
 return <div className="vault-onboarding">
  {step==="recovery"&&<RecoverySetup newAccount={newAccount} onRegistered={()=>setStep(newAccount?"activate":"migration")}/>}
  {step==="activate"&&newAccount&&<NewAccountActivation onContinue={onContinue}/>}
  {step==="migration"&&<MigrationPanel osAvailable={osAvailable} onContinue={onContinue}/>}
  {step==="connect"&&<><DevicePairing osAvailable={osAvailable}/><button type="button" onClick={onContinue}>연결 확인 후 계속</button></>}
  {step==="recover"&&<LostRecoveryPanel osAvailable={osAvailable} onContinue={onContinue}/>}
  {!newAccount&&<details className="vault-other-options"><summary><span>다른 방법으로 연결</span><VscChevronRight aria-hidden="true"/></summary><div className="vault-actions">
   {!connectionOnly&&<button onClick={()=>setStep("recovery")}>복구 자료 준비</button>}
   <button onClick={()=>setStep("connect")}>기존 기기의 QR·파일로 연결</button><button onClick={()=>setStep("recover")}>복구 자료로 연결</button>
  </div></details>}
 </div>;
}
