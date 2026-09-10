const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path");
const {UpdateCoordinator}=require("../public/electron/e2ee/updateCoordinator");
test("signed update coordinator verifies after download and again before installation",async()=>{
 let checks=0;
 const release={version:"2.0.0",mandatory:true,filename:path.resolve("synthetic-installer.exe")};
 const trust={latest:async()=>release,download:async()=>release,verifyBeforeInstall:async()=>{checks++;return release;}};
 const coordinator=new UpdateCoordinator(trust);
 assert.equal((await coordinator.latest()).mandatory,true);
 await assert.rejects(coordinator.verify(release.filename),/UNTRUSTED/);
 assert.equal(await coordinator.download("2.0.0"),release.filename);
 assert.equal(checks,1);
 await coordinator.verify(release.filename);assert.equal(checks,2);
 trust.verifyBeforeInstall=async()=>{throw Error("TAMPERED_OR_REVOKED");};
 await assert.rejects(coordinator.verify(release.filename),/TAMPERED/);
});
test("failed verification never makes an installer eligible to execute",async()=>{
 const release={filename:path.resolve("synthetic-invalid.exe")};
 const coordinator=new UpdateCoordinator({download:async()=>release,verifyBeforeInstall:async()=>{throw Error("INVALID");}});
 await assert.rejects(coordinator.download("2.0.0"),/INVALID/);
 await assert.rejects(coordinator.verify(release.filename),/UNTRUSTED/);
});
