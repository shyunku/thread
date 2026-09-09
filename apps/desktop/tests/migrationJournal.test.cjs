const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {EncryptedStore}=require("../public/electron/e2ee/localStore"),{MigrationJournal}=require("../public/electron/e2ee/migrationJournal");
test("checkpoint survives restart; commit ACK loss needs matching status; no source deletion",async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"thread-migration-journal-")),filename=path.join(directory,"vault.db"),key=Buffer.alloc(32,1);
 const scope={environment:"development",accountId:"fixture",vaultId:"fixture"};let store=new EncryptedStore({filename,key,scope,create:true});
 t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
 let journal=new MigrationJournal(store,scope);journal.begin("fixture-migration");
 assert.throws(()=>journal.advance("PREPARING","ACTIVE",{}),/PHASE/);
 journal.advance("PREPARING","FROZEN",{freezeSeq:"42",sourceEpoch:"old"});journal.advance("FROZEN","UPLOADING",{});
 journal.checkpoint(0,"a".repeat(64));assert.throws(()=>journal.checkpoint(2,"b".repeat(64)),/GAP/);assert.throws(()=>journal.checkpoint(0,"b".repeat(64)),/CHANGED/);
 store.close();store=new EncryptedStore({filename,key,scope});journal=new MigrationJournal(store,scope);assert.equal(journal.get().pages.length,1);
 assert.throws(()=>journal.advance("UPLOADING","VERIFIED",{}),/READBACK/);
 journal.advance("UPLOADING","VERIFIED",{ciphertextManifest:"c".repeat(64),allPagesVerified:true,readbackMatches:true});journal.advance("VERIFIED","COMMITTING",{});
 await assert.rejects(journal.confirmCommitted(async()=>{throw Error("NETWORK_FAILURE")}));assert.equal(journal.get().phase,"COMMITTING");
 const status={id:"fixture-migration",phase:"ACTIVE",vaultId:"fixture",freezeSeq:"42",ciphertextManifest:"c".repeat(64)};
 await assert.rejects(journal.confirmCommitted(async()=>({...status,freezeSeq:"43"})),/UNCONFIRMED/);
 assert.equal((await journal.confirmCommitted(async()=>status)).phase,"ACTIVE");assert.equal(journal.get().pages.length,1);
 assert.throws(()=>new MigrationJournal(store,{...scope,accountId:"other"}).get(),/SCOPE/);
});
