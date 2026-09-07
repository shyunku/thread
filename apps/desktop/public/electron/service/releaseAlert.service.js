const axios = require("axios");
const versions = require("compare-versions");
const PackageJson = require("../../../package.json");
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
    this.timer = setInterval(() => void this.check(), 30000);
    this.timer.unref?.();
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
  async check() {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      try {
        const response = await axios.get(
          process.env.RMS_ENTRY + "/default/release-alert",
          {
            params: {
              category: Util.getSystemArchCategory(),
              include_beta: !!PackageJson.enableBetaUpdate,
            },
            timeout: 10000,
          }
        );
        if (response.data?.code !== 200) return this.current;
        const next = selectRelease(
          response.data.data,
          PackageJson.version,
          !!PackageJson.enableBetaUpdate
        );
        if (next && this.current?.version === next.version) {
          this.current.mandatory = next.mandatory;
        } else {
          this.current = next ? { ...next, status: "available" } : null;
          this.installerPath = null;
        }
        this.publish();
        if (
          this.current?.mandatory &&
          ["available", "failed"].includes(this.current.status)
        )
          void this.download();
      } catch {
        /* Keep an already received required notice during network outages. */
      }
      return this.current;
    })().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }
  async download() {
    if (this.downloading) return this.downloading;
    const alert = this.current;
    if (!alert || alert.status === "ready") return this.current;
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
    });
    return this.downloading;
  }
}
module.exports = { ReleaseAlertService, selectRelease };
