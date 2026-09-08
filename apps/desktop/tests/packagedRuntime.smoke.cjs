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
assert.equal(process.arch, "x64");
assert.equal(metadata.name, "thread");
assert.equal(packagedRequire("./build/electron/modules/appIdentity").getDesktopAppId(metadata), "kr.threadapp.desktop");
for (const name of ["axios", "socket.io-client", "ws", "electron-log", "dotenv", "sha256", "uuid"])
  packagedRequire(name);
packagedRequire("./build/electron/modules/keyProtection");
const fs = require("node:fs"), os = require("node:os");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "thread-packaged-cipher-"));
const filename = path.join(temp, "fixture.db");
const key = require("node:crypto").randomBytes(32);
const scope = { environment: "development", accountId: "fixture", vaultId: "fixture" };
const { EncryptedStore } = packagedRequire("./build/electron/e2ee/localStore");
let store;
try {
  store = new EncryptedStore({ filename, key, scope, create: true });
  store.put("outbox", "one", { title: "SYNTHETIC_PACKAGED_SECRET" });
  for (const name of fs.readdirSync(temp))
    assert.equal(fs.readFileSync(path.join(temp, name)).includes(Buffer.from("SYNTHETIC_PACKAGED_SECRET")), false);
  store.close();
  store = new EncryptedStore({ filename, key, scope });
  assert.equal(store.get("outbox", "one").title, "SYNTHETIC_PACKAGED_SECRET");
} finally { store?.close(); key.fill(0); fs.rmSync(temp, { recursive: true, force: true }); }
packagedRequire("./build/electron/e2ee/trustedUpdates");
const sqlite = packagedRequire("sqlite3");
const db = new sqlite.Database(":memory:", error => {
  if (error) throw error;
  db.get("SELECT 45 AS fixture", (error, row) => {
    if (error) throw error;
    assert.equal(row.fixture, 45);
    db.close(error => {
      if (error) throw error;
      console.log("PASS: packaged x64 Electron, runtime dependencies, SQLite and encrypted DB/WAL/reopen");
    });
  });
});
