const express = require("express");
const path = require("path");
// Only public, offline-signed repository contents belong here. Never store keys.
// Kept separate from legacy release upload paths; admin uploads cannot replace trust.
const root = path.resolve(process.cwd(), "tuf-repository");
const router = express.Router();
const options = { dotfiles: "deny", index: false, redirect: false, fallthrough: false,
  setHeaders(res) { res.setHeader("Cache-Control", "no-store"); } };
router.use("/metadata", express.static(path.join(root, "metadata"), options));
router.use("/targets", express.static(path.join(root, "targets"), options));
module.exports = router;
