const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
module.exports = async function buildAuthHelper(context) {
  if (context.electronPlatformName !== "win32") return;
  const root = context.packager.projectDir;
  await promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/build-auth-helper.ps1")], { cwd: root, windowsHide: true, timeout: 120000 });
  const destination = path.join(root, "build/resources/native");
  await fs.mkdir(destination, {recursive:true});
  await fs.copyFile(path.join(root, "public/resources/native/thread-auth.exe"), path.join(destination, "thread-auth.exe"));
};
