const { ipcMain } = require("electron");
const Util = require("../modules/util");
const FileSystem = require("../modules/filesystem");
const ArchCategory = require("../constants/ArchCategory.constants");
const PackageJson = require("../../../package.json");
const path = require("path");
const fs = require("fs-extra");
const ArchCategoryConstants = require("../constants/ArchCategory.constants");
const ChildProcess = require("child_process");
const dmg = require("../modules/dmg");
const { isTrustedEvent } = require("../modules/windowSecurity");

const serverHost = process.env.RMS_ENTRY;

const UPDATER_RESULT_FLAG = {
  NEW_VERSION_FOUND: 0,
  ALREADY_LATEST: 1,
  UPDATE_CHECK_FAIL: 2,
};

class UpdaterService {
  constructor() {
    /** @type {IpcService} */
    this.ipcService = null;
    /** @type {WindowService} */
    this.windowService = null;
  }

  /**
   * @param serviceGroup {ServiceGroup}
   */
  inject(serviceGroup) {
    this.ipcService = serviceGroup.ipcService;
    this.windowService = serviceGroup.windowService;
  }

  async invokeUpdateChecker() {
    const isProdMode = process.env.NODE_ENV === "production";
    if (!isProdMode) return;

    const osCategory = Util.getSystemArchCategory();

    const window = await this.windowService.createUpdaterWindow({
      webPreferences: {
        preload: path.join(__dirname, "../", "modules", "preload.js"),
      },
    });
    const { result: checkUpdateResult, data } = await this.checkForUpdates(
      osCategory
    );
    switch (checkUpdateResult) {
      case UPDATER_RESULT_FLAG.ALREADY_LATEST:
        // do nothing
        break;
      case UPDATER_RESULT_FLAG.NEW_VERSION_FOUND:
        // Discovery never authorizes downloading or executing an installer.
        // The main window offers an explicit action through ReleaseAlert.
        this.ipcService.silentSender("release_download@skip", true, null);
        break;
      case UPDATER_RESULT_FLAG.UPDATE_CHECK_FAIL:
        console.error(`Couldn't check update. Continuing program...`, data);
        await this.showUpdateCheckFailure(window, data);
        break;
    }
    await Util.sleep(1000);

    if (!window.isDestroyed()) window.close();
  }

  async showUpdateCheckFailure(window, code) {
    const continueTopic = "update_check@continue";

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        ipcMain.removeListener(continueTopic, onContinue);
        window.removeListener("closed", finish);
        resolve();
      };
      const onContinue = (event) => {
        if (event.sender.id !== window.webContents.id) return;
        if (!isTrustedEvent(event, this.windowService.trustedWindows,
            this.windowService.appEntry)) return;
        finish();
      };

      ipcMain.on(continueTopic, onContinue);
      window.once("closed", finish);
      window.webContents.send("update_check@failed", null, {
        success: false,
        data: {
          title: code === "UPDATE_TRUST_NOT_CONFIGURED" ? "업데이트 설정이 필요합니다" : "업데이트를 확인할 수 없습니다",
          message: code === "UPDATE_TRUST_NOT_CONFIGURED"
            ? "이 설치본에는 서명된 업데이트 확인 정보가 없습니다. 현재 버전으로 계속할 수 있지만 자동 업데이트는 사용할 수 없습니다."
            : code === "INVALID_UPDATE_REPOSITORY"
            ? "업데이트 서버의 보안 연결 설정을 확인할 수 없습니다. 현재 버전으로 계속할 수 있습니다."
            : "업데이트 서버에 연결하거나 서명 정보를 확인하지 못했습니다. 현재 버전으로 계속할 수 있습니다.",
        },
      });
    });
  }

  getFileExtensionByCategory(category) {
    switch (category) {
      case ArchCategory.Windows:
        return ".exe";
      case ArchCategory.MacOS:
        return ".dmg";
      default:
        throw new Error(
          `Category '${category}' not supported for get file extension.`
        );
    }
  }

  trustedCoordinator() {
    if(!this.trusted){
      const {TrustedUpdates}=require("../e2ee/trustedUpdates");
      const {UpdateCoordinator}=require("../e2ee/updateCoordinator");
      const platform=Util.getSystemArchCategory(),arch=platform==="mac"&&PackageJson.build?.mac?.target?.some(target=>target.arch?.includes("universal"))?"universal":process.arch;
      this.trusted=new UpdateCoordinator(new TrustedUpdates({
        rootFile:path.join(__dirname,"../../resources/update-trust/root.json"),
        cacheDir:path.join(FileSystem.getUserDataPath(),"trusted-updates",platform+"-"+arch),
        repositoryURL:new URL("/tuf/",serverHost).href,
        platform,arch,installedVersion:PackageJson.version,
      }));
    }
    return this.trusted;
  }

  latestTrustedRelease() {
    const beta=!!PackageJson.enableBetaUpdate||require("../modules/appSettings").getSettings().betaUpdates;
    return this.trustedCoordinator().latest(beta);
  }

  async checkForUpdates(category) {
    try{
      if(category!==Util.getSystemArchCategory())throw Error("INVALID_UPDATE_PLATFORM");
      const release=await this.latestTrustedRelease();
      if(release)return {result:UPDATER_RESULT_FLAG.NEW_VERSION_FOUND,data:release};
      this.ipcService.silentSender("release_download@skip",true,null);
      return {result:UPDATER_RESULT_FLAG.ALREADY_LATEST,data:null};
    }catch(error){
      const code=["UPDATE_TRUST_NOT_CONFIGURED","INVALID_UPDATE_REPOSITORY"].includes(error.message)?error.message:"SIGNED_UPDATE_UNAVAILABLE";
      return {result:UPDATER_RESULT_FLAG.UPDATE_CHECK_FAIL,data:code};
    }
  }

  async updateToNewVersion(osCategory, userDataPath, version) {
    if(osCategory!==Util.getSystemArchCategory())throw Error("INVALID_UPDATE_PLATFORM");
    this.ipcService.silentSender("release_download@initial", true, version);
    const file = await this.trustedCoordinator().download(version);
    this.ipcService.silentSender("release_download@done", true, null);
    return file;
  }

  async installNewVersion(osCategory, userDataPath, installerPath) {
    if(osCategory!==Util.getSystemArchCategory())throw Error("INVALID_UPDATE_PLATFORM");
    await this.trustedCoordinator().verify(installerPath);
    if (fs.existsSync(installerPath)) {
      switch (osCategory) {
        case ArchCategoryConstants.Windows:
          await new Promise((resolve,reject)=>{
            const child=ChildProcess.spawn(installerPath,{detached:true,stdio:"ignore"});
            child.once("spawn",()=>{child.unref();resolve();});
            child.once("error",reject);
          });
          return false;
        case ArchCategoryConstants.MacOS:
          console.debug(`Mounting dmg file...`);
          this.ipcService.silentSender(
            "release_install@state",
            true,
            "mounting"
          );
          const mountPath = await dmg.mountSync(installerPath);

          const appName = "Thread.app";
          const mountedAppPath = path.resolve(mountPath, appName);
          const applicationDestFolder = `/Applications/${appName}`;

          console.debug(`Copying to application folder...`);
          this.ipcService.silentSender(
            "release_install@state",
            true,
            "copying"
          );
          process.noAsar = true;
          fs.copySync(mountedAppPath, applicationDestFolder, {
            overwrite: true,
            recursive: true,
            dereference: true,
          });

          console.debug(`Unmounting dmg file...`);
          this.ipcService.silentSender(
            "release_install@state",
            true,
            "unmounting"
          );
          await dmg.unmountSync(installerPath);

          return true;
        default:
          throw new Error(`Can't find arch named '${osCategory}'.`);
      }
    } else {
      throw new Error(
        `Can't find installer on destination path: ${installerPath}`
      );
    }
  }
}

module.exports = UpdaterService;
