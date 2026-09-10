const fs = require("node:fs");
const path = require("node:path");
const { Updater } = require("tuf-js");
const versions = require("compare-versions");
function validateTarget(info, { platform, arch, version, installedVersion }) {
  const meta = info?.custom?.thread;
  if (!meta || meta.schema !== 1 || meta.platform !== platform || meta.arch !== arch ||
      meta.version !== version || typeof meta.mandatory !== "boolean" ||
      !versions.validate(version) || !versions.validate(installedVersion) ||
      !versions.compare(version, installedVersion, ">") ||
      !Number.isSafeInteger(info.length) || info.length < 1 || info.length > 2 * 1024 ** 3)
    throw Error("UNTRUSTED_RELEASE_TARGET");
  return { version: meta.version, mandatory: meta.mandatory, platform, arch };
}
class TrustedUpdates {
  #options;
  #client;
  constructor({ rootFile, cacheDir, repositoryURL, platform, arch, installedVersion }) {
    const url = new URL(repositoryURL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      throw Error("INVALID_UPDATE_REPOSITORY");
    if (!["win","mac"].includes(platform) || !["ia32","x64","arm64","universal"].includes(arch) ||
        !versions.validate(installedVersion)) throw Error("INVALID_UPDATE_PLATFORM");
    // Root is shipped with the app. Never bootstrap trust from the mirror.
    if (!rootFile || !fs.existsSync(rootFile)) throw Error("UPDATE_TRUST_NOT_CONFIGURED");
    const metadataDir = path.join(cacheDir,"metadata"), targetDir = path.join(cacheDir,"targets");
    fs.mkdirSync(metadataDir,{recursive:true,mode:0o700});
    fs.mkdirSync(targetDir,{recursive:true,mode:0o700});
    const root = path.join(metadataDir,"root.json");
    try { fs.copyFileSync(rootFile,root,fs.constants.COPYFILE_EXCL); }
    catch(error) { if(error.code !== "EEXIST") throw error; }
    // Reuse the cache: resetting it would discard TUF's rollback history.
    this.#client = new Updater({
      metadataDir, targetDir,
      metadataBaseUrl: new URL("metadata/",url.href.endsWith("/")?url:new URL(url.href+"/")).href,
      targetBaseUrl: new URL("targets/",url.href.endsWith("/")?url:new URL(url.href+"/")).href,
      config: { fetchTimeout:10000,fetchRetries:0,maxRootRotations:32,maxDelegations:16,targetsMaxLength:1024*1024 },
    });
    this.#options={platform,arch,installedVersion};
  }
  async download(version) {
    if (!versions.validate(version) || !/^[0-9A-Za-z.+-]+$/.test(version)) throw Error("INVALID_RELEASE");
    await this.#client.refresh();
    const {platform,arch}=this.#options;
    const targetPath = [platform,arch,version,platform==="win"?"installer.exe":"installer.dmg"].join("/");
    const info = await this.#client.getTargetInfo(targetPath);
    const release = validateTarget(info,{...this.#options,version});
    const filename = await this.#client.downloadTarget(info);
    return { ...release, filename };
  }
  async latest(includeBeta=false) {
    await this.#client.refresh();
    const catalogInfo=await this.#client.getTargetInfo("releases.json");
    if(!catalogInfo||!Number.isSafeInteger(catalogInfo.length)||catalogInfo.length<1||catalogInfo.length>128*1024)
      throw Error("INVALID_RELEASE_CATALOG");
    const filename=await this.#client.downloadTarget(catalogInfo);
    const raw=fs.readFileSync(filename);
    if(raw.length>128*1024)throw Error("INVALID_RELEASE_CATALOG");
    // Verify again after reading the local cache, before using catalog fields.
    await catalogInfo.verify(require("node:stream").Readable.from([raw]));
    const catalog=JSON.parse(raw.toString("utf8"));
    if(catalog?.schema!==1||!Array.isArray(catalog.releases)||catalog.releases.length>512)
      throw Error("INVALID_RELEASE_CATALOG");
    const {platform,arch,installedVersion}=this.#options,candidates=[];
    for(const row of catalog.releases){
      if(!row||!["win","mac"].includes(row.platform)||!["ia32","x64","arm64","universal"].includes(row.arch)||
        !versions.validate(row.version)||!/^[0-9A-Za-z.+-]+$/.test(row.version))throw Error("INVALID_RELEASE_CATALOG");
      if(row.platform!==platform||row.arch!==arch||!versions.compare(row.version,installedVersion,">")||
        (!includeBeta&&row.version.split("+")[0].includes("-")))continue;
      const info=await this.#client.getTargetInfo([platform,arch,row.version,platform==="win"?"installer.exe":"installer.dmg"].join("/"));
      candidates.push(validateTarget(info,{...this.#options,version:row.version}));
    }
    candidates.sort((a,b)=>versions.compare(a.version,b.version,">")?-1:versions.compare(a.version,b.version,"<")?1:0);
    return candidates.length?{...candidates[0],mandatory:candidates.some(row=>row.mandatory)}:null;
  }
  async verifyBeforeInstall(release) {
    // Verify fresh metadata and the current bytes, even if the target was cached.
    await this.#client.refresh();
    const {platform,arch}=this.#options;
    const targetPath=[platform,arch,release.version,platform==="win"?"installer.exe":"installer.dmg"].join("/");
    const info=await this.#client.getTargetInfo(targetPath);
    const verified=validateTarget(info,{...this.#options,version:release.version});
    await info.verify(fs.createReadStream(release.filename));
    return verified;
  }
}
module.exports={TrustedUpdates,validateTarget};
