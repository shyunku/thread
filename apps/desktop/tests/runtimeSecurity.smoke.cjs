// Synthetic only: no env files, real account, app DB or network.
// Run as Electron with ELECTRON_RUN_AS_NODE unset.
const { app, safeStorage } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createKeyProtection } = require("../public/electron/modules/keyProtection");
assert.ok(app, "Run this test with Electron");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "thread-keystore-test-"));
app.setPath("userData", temp);
app.setPath("sessionData", temp);
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const protector = createKeyProtection({ app, safeStorage });
  const scope = { environment: "development", accountId: "synthetic-only", purpose: "ldk" };
  const key = randomBytes(32);
  const wrapped = protector.protect(key, scope);
  assert.equal(wrapped.includes(key), false);
  const recovered = protector.unprotect(wrapped, scope);
  assert.deepEqual(recovered, key);
  assert.throws(() => protector.unprotect(wrapped, { ...scope, accountId: "other" }), /KEY_CONTEXT_MISMATCH/);
  const corrupted = Buffer.from(wrapped);
  corrupted.fill(0);
  assert.throws(() => protector.unprotect(corrupted, scope), /KEY_UNWRAP_FAILED/);
  recovered.fill(0); key.fill(0);

  const sqlite = require("sqlite3");
  const db = await new Promise((resolve, reject) => {
    const instance = new sqlite.Database(":memory:", error => error ? reject(error) : resolve(instance));
  });
  await new Promise((resolve, reject) => db.run("CREATE TABLE fixture (value TEXT NOT NULL)", error => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => db.run("INSERT INTO fixture VALUES (?)", ["synthetic"], error => error ? reject(error) : resolve()));
  const row = await new Promise((resolve, reject) => db.get("SELECT value FROM fixture", (error, row) => error ? reject(error) : resolve(row)));
  assert.equal(row.value, "synthetic");
  await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  console.log(JSON.stringify({ electron: process.versions.electron, platform: process.platform, arch: process.arch, osKeyRoundTrip: true, sqlite: true }));
  clearTimeout(timeout);
  app.exit(0);
}).catch(error => {
  console.error(error.code || error.message);
  clearTimeout(timeout);
  app.exit(1);
});
