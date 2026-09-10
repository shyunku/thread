const path=require("node:path");
// No unsigned discovery/download fallback. Only this process's verified
// downloads may reach installation, with fresh metadata and bytes checked again.
class UpdateCoordinator{
 constructor(trust){this.trust=trust;this.downloads=new Map();}
 latest(includeBeta){return this.trust.latest(includeBeta);}
 async download(version){
  const release=await this.trust.download(version);
  await this.trust.verifyBeforeInstall(release);
  const filename=path.resolve(release.filename);
  this.downloads.set(filename,{...release,filename});return filename;
 }
 async verify(filename){
  if(typeof filename!=="string")throw Error("UNTRUSTED_INSTALLER");
  const release=this.downloads.get(path.resolve(filename));
  if(!release)throw Error("UNTRUSTED_INSTALLER");
  return this.trust.verifyBeforeInstall(release);
 }
}
module.exports={UpdateCoordinator};
