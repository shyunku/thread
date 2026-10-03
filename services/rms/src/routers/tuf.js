const express = require("express");
const path = require("path");
// Only public, offline-signed repository contents belong here. Never store keys.
// Kept separate from legacy release upload paths; admin uploads cannot replace trust.
const root = path.resolve(process.cwd(), "tuf-repository");
const router = express.Router();
// Installers are stored as <platform>/<arch>/<version>/installer.<ext>. Browsers
// downloading one from the website get a recognizable file name instead.
function downloadName(filePath) {
  const parts = path.relative(root, filePath).split(path.sep);
  const [area, platform, , version, file] = parts;
  if (parts.length !== 5 || area !== "targets" || !/^[0-9A-Za-z.+-]+$/.test(version)) return null;
  if (platform === "win" && file === "installer.exe") return `Thread-Setup-${version}.exe`;
  if (platform === "mac" && file === "installer.dmg") return `Thread-${version}.dmg`;
  return null;
}
const options = { dotfiles: "deny", index: false, redirect: false, fallthrough: false,
  setHeaders(res, filePath) {
    res.setHeader("Cache-Control", "no-store");
    const name = downloadName(filePath);
    if (name) res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  } };
router.use("/metadata", express.static(path.join(root, "metadata"), options));
router.use("/targets", express.static(path.join(root, "targets"), options));
module.exports = router;
module.exports.downloadName = downloadName;
