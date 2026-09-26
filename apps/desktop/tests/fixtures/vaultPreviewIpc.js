const stage=new URLSearchParams(window.location.search).get("stage")||"setup";
const ok=(cb,data)=>cb?.({success:true,data});
export default {onAll:()=>()=>{},off:()=>{},system:{minimizeWindow:()=>{},closeWindow:()=>{}},
 syncV2:{getStatus:cb=>ok(cb,{uid:"fixture",protocolVersion:3,connected:true,pending:0,seq:"12",canSync:true}),retry:cb=>ok(cb,{})},
 vault:{windowMode:(mode,cb)=>ok(cb,true),bootstrap:(uid,cb)=>ok(cb,{mode:stage==="unlock"?"LOCKED":"MIGRATION_REQUIRED"}),
 status:cb=>ok(cb,{uid:"fixture",phase:["setup","password"].includes(stage)?"ABSENT":stage==="unlock"?"LOCKED":"UNLOCKED",enabled:true,osAvailable:true,passwordAvailable:true,generation:1}),intakes:cb=>ok(cb,[]),
 identityStatus:cb=>ok(cb,{phase:stage==="register"?"RECOVERY_CONFIRMED":"RECOVERY_UNCONFIRMED",fingerprint:"synthetic-fingerprint"}),exportRecovery:cb=>ok(cb,true),recoveryCodePreview:cb=>ok(cb,"THREAD1-F*******-"+Array(8).fill("********").join("-")),copyRecoveryCode:cb=>ok(cb,true),registrationEndpoint:cb=>ok(cb,"http://127.0.0.1:4033"),migrationStatus:cb=>ok(cb,{phase:stage==="migration-complete"?"ACTIVE":"NOT_STARTED"})}
};
