// node src/routers/tuf.test.js
const assert = require("node:assert/strict");
const path = require("node:path");
const { downloadName } = require("./tuf");
const root = path.resolve(process.cwd(), "tuf-repository");
const file = (...parts) => path.join(root, ...parts);
assert.equal(downloadName(file("targets", "win", "x64", "2.0.3", "installer.exe")), "Thread-Setup-2.0.3.exe");
assert.equal(downloadName(file("targets", "mac", "universal", "2.1.0", "installer.dmg")), "Thread-2.1.0.dmg");
assert.equal(downloadName(file("targets", "releases.json")), null);
assert.equal(downloadName(file("metadata", "win", "x64", "2.0.3", "installer.exe")), null);
assert.equal(downloadName(file("targets", "win", "x64", "2.0.3\"x", "installer.exe")), null);
console.log("tuf download names ok");
