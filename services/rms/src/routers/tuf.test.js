// node src/routers/tuf.test.js
const assert = require("node:assert/strict");
const path = require("node:path");
const { downloadName, cacheControl } = require("./tuf");
const root = path.resolve(process.cwd(), "tuf-repository");
const file = (...parts) => path.join(root, ...parts);
assert.equal(downloadName(file("targets", "win", "x64", "2.0.3", "installer.exe")), "Thread-Setup-2.0.3.exe");
assert.equal(downloadName(file("targets", "mac", "universal", "2.1.0", "installer.dmg")), "Thread-2.1.0.dmg");
assert.equal(downloadName(file("targets", "releases.json")), null);
assert.equal(downloadName(file("metadata", "win", "x64", "2.0.3", "installer.exe")), null);
assert.equal(downloadName(file("targets", "win", "x64", "2.0.3\"x", "installer.exe")), null);
assert.equal(cacheControl(file("targets", "win", "x64", "2.2.0", "installer.exe")), "public, max-age=31536000, immutable");
assert.equal(cacheControl(file("targets", "releases.json")), "no-store");
assert.equal(cacheControl(file("metadata", "timestamp.json")), "no-store");
console.log("tuf download names ok");
