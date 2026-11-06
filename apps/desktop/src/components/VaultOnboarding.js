import {useEffect,useState} from "react";
import RecoverySetup from "./RecoverySetup";
import NewAccountActivation from "./NewAccountActivation";
// New account setup: recovery material first, then the empty encrypted vault starts.
export default function VaultOnboarding({onContinue,onStepChange}){
 const [step,setStep]=useState("recovery");
 useEffect(()=>onStepChange?.(step),[step,onStepChange]);
 return <div className="vault-onboarding">
  {step==="recovery"&&<RecoverySetup newAccount onRegistered={()=>setStep("activate")}/>}
  {step==="activate"&&<NewAccountActivation onContinue={onContinue}/>}
 </div>;
}
