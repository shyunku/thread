const p=require("./protocol");
const KEY="$e2ee-migration";
const transitions={PREPARING:"FROZEN",FROZEN:"UPLOADING",UPLOADING:"VERIFIED",VERIFIED:"COMMITTING",COMMITTING:"ACTIVE"};
// Journal only. No filesystem deletion or automatic server/account cutover.
class MigrationJournal{
 constructor(store,scope){this.store=store;this.scope=p.decode(p.encode(scope));}
 get(){const state=this.store.get("recovery",KEY);if(state&&!p.encode(state.scope).equals(p.encode(this.scope)))throw Error("MIGRATION_SCOPE_MISMATCH");return state;}
 begin(id){if(typeof id!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw Error("INVALID_MIGRATION_ID");return this.store.transaction(db=>{const old=this.get();if(old){if(old.id!==id)throw Error("MIGRATION_ALREADY_EXISTS");return old;}const state={id,scope:this.scope,phase:"PREPARING",pages:[]};db.put("recovery",KEY,state);return state;});}
 advance(expected,phase,evidence){return this.store.transaction(db=>{
  const state=this.get();if(!state||state.phase!==expected||transitions[expected]!==phase)throw Error("MIGRATION_PHASE_CONFLICT");
  if(!evidence||typeof evidence!=="object")throw Error("MIGRATION_EVIDENCE_REQUIRED");
  if(phase==="FROZEN"&&(!/^(0|[1-9][0-9]*)$/.test(evidence.freezeSeq)||typeof evidence.sourceEpoch!=="string"||!evidence.sourceEpoch))throw Error("MIGRATION_FREEZE_REQUIRED");
  if(phase==="VERIFIED"&&(!/^[a-f0-9]{64}$/.test(evidence.ciphertextManifest)||evidence.readbackMatches!==true||evidence.allPagesVerified!==true))throw Error("MIGRATION_READBACK_REQUIRED");
  if(phase==="ACTIVE")throw Error("MIGRATION_STATUS_QUERY_REQUIRED");
  const next={...state,phase,evidence:{...(state.evidence||{}),...evidence}};db.put("recovery",KEY,next);return next;
 });}
 checkpoint(page,ciphertextDigest){this.store.transaction(db=>{const state=this.get();if(!state||state.phase!=="UPLOADING"||!Number.isSafeInteger(page)||page<0||!/^[a-f0-9]{64}$/.test(ciphertextDigest))throw Error("INVALID_MIGRATION_PAGE");const old=state.pages.find(p=>p.page===page);if(old&&old.digest!==ciphertextDigest)throw Error("MIGRATION_PAGE_CHANGED");if(!old){if(page!==state.pages.length)throw Error("MIGRATION_PAGE_GAP");db.put("recovery",KEY,{...state,pages:[...state.pages,{page,digest:ciphertextDigest}]});}});}
 async confirmCommitted(queryStatus){const before=this.get();if(!before||before.phase!=="COMMITTING")throw Error("MIGRATION_PHASE_CONFLICT");const status=await queryStatus(before.id);
  return this.store.transaction(db=>{const state=this.get();if(!p.encode(state).equals(p.encode(before)))throw Error("MIGRATION_CHANGED");
   if(status.id!==state.id||status.phase!=="ACTIVE"||status.vaultId!==this.scope.vaultId||status.freezeSeq!==state.evidence.freezeSeq||status.ciphertextManifest!==state.evidence.ciphertextManifest)throw Error("MIGRATION_COMMIT_UNCONFIRMED");
   const next={...state,phase:"ACTIVE"};db.put("recovery",KEY,next);return next;
  });
 }
 async confirmCancelled(queryStatus){
  const before=this.get();if(!before||!["PREPARING","FROZEN"].includes(before.phase))throw Error("MIGRATION_PHASE_CONFLICT");
  const status=await queryStatus(before.id);
  return this.store.transaction(db=>{
   const state=this.get();if(!p.encode(state).equals(p.encode(before)))throw Error("MIGRATION_CHANGED");
   if(status.id!==state.id||status.phase!=="CANCELLED"||status.vaultId!==this.scope.vaultId||
    (state.evidence?.freezeSeq!==undefined&&status.freezeSeq!==state.evidence.freezeSeq))throw Error("MIGRATION_CANCEL_UNCONFIRMED");
   const next={...state,phase:"CANCELLED"};db.put("recovery",KEY,next);return next;
  });
 }
}
module.exports={MigrationJournal};
