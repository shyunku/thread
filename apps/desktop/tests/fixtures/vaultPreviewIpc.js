const stage=new URLSearchParams(window.location.search).get("stage")||"setup";
const ok=(cb,data)=>cb?.({success:true,data});
// The new account flow moves on: a lock is made, then the recovery check passes.
let created=["resume","settings"].includes(stage),confirmed=stage==="resume";
export default {onAll:()=>()=>{},off:()=>{},system:{minimizeWindow:()=>{},closeWindow:()=>{}},
 releaseAlerts:{get:cb=>ok(cb,new URLSearchParams(window.location.search).get("update")?{version:"2.0.7",status:"available",mandatory:false}:null)},
 syncV2:{getStatus:cb=>ok(cb,{uid:"fixture",protocolVersion:3,connected:true,pending:0,seq:"12",canSync:true}),retry:cb=>ok(cb,{})},
 vault:{windowMode:(mode,cb)=>ok(cb,true),bootstrap:(uid,cb)=>ok(cb,{mode:stage==="unlock"?"LOCKED":stage==="connect"?"SETUP_REQUIRED":"NEW_ACCOUNT_SETUP"}),
 create:(password,cb)=>{created=true;ok(cb,{uid:"fixture",phase:"UNLOCKED",osAvailable:true,generation:1});},
 relay:(()=>{let polls=0,confirmed=false;return (action,input,cb)=>{
  if(action==="recipientPoll"){polls++;return ok(cb,confirmed?{phase:polls>2?"PAIRED":"APPROVAL",code:"482913",expiresAt:Date.now()+480000}:polls<3?{phase:"WAITING"}:polls<4?{phase:"CONNECTING"}:{phase:"COMPARE",code:"482913",expiresAt:Date.now()+540000});}
  if(action==="recipientConfirm"){confirmed=true;polls=0;return ok(cb,{phase:"APPROVAL",code:"482913",expiresAt:Date.now()+480000});}
  return ok(cb,{phase:"CANCELLED"});};})(),
 lostRecovery:(action,input,cb)=>ok(cb,action==="status"?null:action==="code"?"THREAD1-6R2KQ9WM-3HXT7NPA-Z5DC8VJE-2LBF4YGU-M2QF7BNU-4VXK9RGD-T6WA3HPC-8NYE5JZL":action==="export"?true:{phase:{prepare:"RECOVERY_UNCONFIRMED",confirm:"RECOVERY_CONFIRMED",commit:"ACTIVE"}[action]}),
 status:cb=>ok(cb,{uid:"fixture",phase:stage==="unlock"?"LOCKED":created&&stage!=="connect"?"UNLOCKED":"ABSENT",enabled:true,osAvailable:true,passwordAvailable:true,generation:1}),
 identityStatus:cb=>ok(cb,{phase:confirmed?"RECOVERY_CONFIRMED":"RECOVERY_UNCONFIRMED",fingerprint:"synthetic-fingerprint"}),confirmRecovery:(code,cb)=>{confirmed=true;ok(cb,{phase:"RECOVERY_CONFIRMED",fingerprint:"synthetic-fingerprint"});},exportRecovery:cb=>ok(cb,true),recoveryCodePreview:cb=>ok(cb,"THREAD1-F52B8***-"+Array(8).fill("********").join("-")),copyRecoveryCode:cb=>ok(cb,true),registrationEndpoint:cb=>ok(cb,"http://127.0.0.1:4033"),registerIdentity:cb=>ok(cb,{phase:"REGISTERED"}),activateEmpty:cb=>stage==="start-error"?cb({success:false,data:{code:"VAULT_ACTION_FAILED"}}):ok(cb,{phase:"ACTIVE"})}
};
