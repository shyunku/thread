// Run with the packaged Thread.exe in ELECTRON_RUN_AS_NODE=1 mode.
// Does not start Thread, read env, or open an existing database.
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const bundle = path.resolve(process.argv[2]);
const packagedRequire = createRequire(path.join(bundle, "package.json"));
const metadata = packagedRequire("./package.json");
assert.equal(metadata.main, "build/electron/core/main.js");
assert.equal(process.versions.electron, "43.6.0");
assert.equal(process.arch, "ia32");
for (const name of ["axios", "socket.io-client", "ws", "electron-log", "dotenv", "sha256", "uuid"])
  packagedRequire(name);
packagedRequire("./build/electron/modules/keyProtection");
const sqlite = packagedRequire("sqlite3");
const db = new sqlite.Database(":memory:", error => {
  if (error) throw error;
  db.get("SELECT 45 AS fixture", (error, row) => {
    if (error) throw error;
    assert.equal(row.fixture, 45);
    db.close(error => {
      if (error) throw error;
      console.log("PASS: packaged ia32 Electron, main metadata, runtime dependencies and SQLite");
    });
  });
});
