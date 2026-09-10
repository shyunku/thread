const fs=require("node:fs");
// Preserve the old file read-only before selecting the encrypted application.
// A live v2 instance must be closed, not raced or silently truncated.
async function capture(service,entry){
 const store=entry.controller.use(value=>value),legacy=service.group?.syncV2Service,filename=legacy?.file(entry.uid);
 if(!filename||!fs.existsSync(filename)||store.get("recovery","$migration-local-intake"))return;
 if(legacy.sessions.has(entry.uid)||legacy.opening?.has(entry.uid))throw Error("MIGRATION_RESTART_REQUIRED");
 const generation=service.generation;
 const intake=await require("./legacyPending").preserveLegacyPending({filename,store,accountId:entry.uid});
 if(service.active!==entry||generation!==service.generation||entry.abort.signal.aborted)throw Error("VAULT_SESSION_CHANGED");
 entry.controller.use(db=>db.put("recovery","$migration-local-intake",{id:intake.id}));
}
module.exports={capture};
