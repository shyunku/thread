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

  const { LocalVault } = require("../public/electron/e2ee/localVault");
  const vaultScope = { environment: "development", accountId: "synthetic-only", vaultId: "fixture" };
  const baseDirectory = path.join(temp, "vaults");
  const vault = new LocalVault({ baseDirectory, scope: vaultScope, protector });
  vault.create();
  let encryptedStore = vault.open();
  encryptedStore.put("outbox", "fixture", { title: "SYNTHETIC_DPAPI_VAULT_DATA" });
  encryptedStore.close();
  encryptedStore = new LocalVault({ baseDirectory, scope: vaultScope, protector }).open();
  assert.equal(encryptedStore.get("outbox", "fixture").title, "SYNTHETIC_DPAPI_VAULT_DATA");
  encryptedStore.close();
  const vaultDirectory = path.join(baseDirectory, fs.readdirSync(baseDirectory)[0]);
  const { createVaultController } = require("../public/electron/e2ee/vaultController");
  const { EventEmitter } = require("node:events");
  const monitor = new EventEmitter(); monitor.getSystemIdleTime = () => 0;
  let cleared = 0;
  const controller = createVaultController({ vault, osAuth: {verify:async()=>true},
    getWindow:()=>null, clearRenderer:()=>{cleared++;}, powerMonitor:monitor });
  try {
    await controller.unlock("os"); // Synthetic auth stub; native auth is user-tested separately.
    assert.equal(controller.use(db=>db.get("outbox","fixture")).title,"SYNTHETIC_DPAPI_VAULT_DATA");
    monitor.emit("lock-screen");
    assert.throws(()=>controller.use(()=>{}),/VAULT_LOCKED/);
    assert.equal(cleared,1);
    await controller.unlock("os");
    monitor.emit("suspend");
    assert.throws(()=>controller.use(()=>{}),/VAULT_LOCKED/);
  } finally {controller.dispose();}
  for (const name of fs.readdirSync(vaultDirectory))
    assert.equal(fs.readFileSync(path.join(vaultDirectory, name)).includes(Buffer.from("SYNTHETIC_DPAPI_VAULT_DATA")), false);
  console.log("PASS: OS-protected persistent LDK and encrypted vault reopen");

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
