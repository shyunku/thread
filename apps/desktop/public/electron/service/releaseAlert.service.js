const versions = require("compare-versions");
const CHECK_INTERVAL_MS = 15000;
const Util = require("../modules/util");
const FileSystem = require("../modules/filesystem");

function selectRelease(releases, currentVersion, includeBeta = false) {
  if (!Array.isArray(releases) || !versions.validate(currentVersion))
    return null;
  const newer = releases.filter(
    (row) =>
      row &&
      typeof row.version === "string" &&
      versions.validate(row.version) &&
      (includeBeta || !row.beta) &&
      versions.compare(row.version, currentVersion, ">")
  );
  newer.sort((a, b) =>
    versions.compare(b.version, a.version, ">")
      ? 1
      : versions.compare(a.version, b.version, ">")
      ? -1
      : 0
  );
  return newer.length
    ? {
        version: newer[0].version,
        mandatory: newer.some((row) => row.mandatory === true),
      }
    : null;
}

class ReleaseAlertService {
  constructor() {
    this.current = null;
    this.checking = null;
    this.downloading = null;
  }
  inject(group) {
    this.group = group;
  }
  start() {
    if (this.timer) return;
    void this.check();
    // Signed metadata is tiny; check every 15 s and right away when the window regains focus.
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
    const window = this.group?.windowService?.mainWindow;
    if (window && !window.isDestroyed()) window.on("focus", () => void this.check());
  }
  publish() {
    const window = this.group.windowService?.mainWindow;
    if (window && !window.isDestroyed()) {
      window.webContents.send("release-alert/available", null, {
        success: true,
        data: this.current,
      });
    }
  }
  // Manual check from the tray: shows the update notice, or tells the user there is none.
  async checkFromTray() {
    const found = await this.check();
    const window = this.group.windowService?.mainWindow;
    if (found && window && !window.isDestroyed()) {
      window.show();
      window.focus();
      window.webContents.send("release-alert/open", null, { success: true, data: found });
      return "available";
    }
    const { Notification } = require("electron");
    const PackageJson = require("../../../package.json");
    const result = this.lastCheckFailed ? "failed" : "latest";
    if (Notification?.isSupported?.()) {
      new Notification(result === "failed"
        ? { title: "업데이트를 확인하지 못했어요", body: "인터넷 연결을 확인한 뒤 다시 시도해 주세요." }
        : { title: "최신 버전이에요", body: `Thread ${PackageJson.version}을 쓰고 있어요.` }).show();
    }
    return result;
  }
  async check() {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      try {
        const next = await this.group.updaterService.latestTrustedRelease();
        if (next && this.current?.version === next.version) {
          this.current.mandatory = next.mandatory;
        } else {
          this.current = next ? { ...next, status: "available" } : null;
          this.installerPath = null;
        }
        this.lastCheckFailed = false;
        this.publish();
      } catch {
        /* Keep an already received required notice during network outages. */
        this.lastCheckFailed = true;
      }
      return this.current;
    })().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }
  async download() {
    // A download started for a version that a newer check replaced still has to finish
    // (the trusted update queue runs one at a time); then this one starts.
    while (this.downloading) {
      if (this.downloadingAlert === this.current) return this.downloading;
      await this.downloading;
    }
    const alert = this.current;
    if (!alert || alert.status === "ready") return this.current;
    this.downloadingAlert = alert;
    this.downloading = (async () => {
      alert.status = "downloading";
      this.publish();
      try {
        const file = await this.group.updaterService.updateToNewVersion(
          Util.getSystemArchCategory(),
          FileSystem.getUserDataPath(),
          alert.version
        );
        if (!file) throw Error("DOWNLOAD_FAILED");
        if (this.current === alert) {
          this.installerPath = file;
          alert.status = "ready";
        }
      } catch {
        if (this.current === alert) alert.status = "failed";
      }
      this.publish();
      return this.current;
    })().finally(() => {
      this.downloading = null;
      this.downloadingAlert = null;
    });
    return this.downloading;
  }
  // One-step update (#100): download when needed, then install and restart. Cancelling
  // only stops waiting; a running download still finishes so the next update is instant.
  async update() {
    const alert = this.current;
    if (!alert) throw Error("NO_UPDATE");
    if (alert.status === "installing") return alert;
    alert.autoInstall = true;
    alert.installFailed = false;
    this.publish();
    if (alert.status !== "ready") await this.download();
    if (this.current !== alert || !alert.autoInstall || alert.status === "installing") return this.current;
    if (alert.status !== "ready") {
      alert.autoInstall = false;
      this.publish();
      return this.current;
    }
    alert.status = "installing";
    this.publish();
    try {
      await this.install();
    } catch (error) {
      if (this.current === alert) {
        alert.status = "ready";
        alert.autoInstall = false;
        alert.installFailed = true;
        this.publish();
      }
      throw error;
    }
    return this.current;
  }
  cancel() {
    const alert = this.current;
    if (alert && alert.status !== "installing" && alert.autoInstall) {
      alert.autoInstall = false;
      this.publish();
    }
    return this.current;
  }
  async install() {
    if (this.downloading || !["ready", "installing"].includes(this.current?.status) || !this.installerPath)
      throw Error("INSTALLER_NOT_READY");
    const installerPath = this.installerPath;
    const relaunch = await this.group.updaterService.installNewVersion(
      Util.getSystemArchCategory(), FileSystem.getUserDataPath(), installerPath
    );
    const { app } = require("electron");
    if (relaunch) app.relaunch();
    app.exit();
  }
}
module.exports = { ReleaseAlertService, selectRelease };
