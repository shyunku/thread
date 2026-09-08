const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const execute = promisify(execFile);
function createOSAuth({ app, systemPreferences, platform = process.platform, resourcesPath = process.resourcesPath }) {
  let busy = false;
  const helper = app.isPackaged ? path.join(resourcesPath, "resources/native/thread-auth.exe")
    : path.resolve(__dirname, "../../resources/native/thread-auth.exe");
  async function availability() {
    if (platform === "darwin") return !!systemPreferences.canPromptTouchID();
    if (platform !== "win32" || !fs.existsSync(helper)) return false;
    try {
      const result = await execute(helper, ["check"], { windowsHide: true, timeout: 10000, maxBuffer: 1024 });
      return result.stdout.trim() === "available";
    } catch { return false; }
  }
  async function verify(window) {
    if (busy) throw Error("OS_AUTH_BUSY");
    if (!window || window.isDestroyed() || !window.isFocused()) throw Error("OS_AUTH_WINDOW_REQUIRED");
    busy = true;
    try {
      if (!await availability()) throw Error("OS_AUTH_UNAVAILABLE");
      if (platform === "darwin") {
        try { await systemPreferences.promptTouchID("unlock your Thread vault"); }
        catch { throw Error("OS_AUTH_CANCELLED"); }
        if (window.isDestroyed()) throw Error("OS_AUTH_CANCELLED");
        return true;
      }
      const handle = window.getNativeWindowHandle();
      if (handle.length !== 8) throw Error("OS_AUTH_UNSUPPORTED_ARCH");
      const challenge = randomBytes(32).toString("hex");
      let response;
      try {
        response = await execute(helper, ["verify", handle.readBigUInt64LE().toString(16), String(process.pid), challenge],
          { windowsHide: true, timeout: 60000, maxBuffer: 1024 });
      } catch { throw Error("OS_AUTH_FAILED"); }
      if (window.isDestroyed() || response.stdout.trim() !== "verified:" + challenge) throw Error("OS_AUTH_CANCELLED");
      return true;
    } finally { busy = false; }
  }
  return { availability, verify };
}
module.exports = { createOSAuth };
