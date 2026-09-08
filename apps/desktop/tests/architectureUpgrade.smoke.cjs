// Synthetic cross-architecture storage test. Never starts the application's main.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
async function child(mode, bundle, filename) {
  const sqlite = createRequire(path.join(path.resolve(bundle), "package.json"))("sqlite3");
  const db = await new Promise((resolve, reject) => {
    const opened = new sqlite.Database(filename, error => error ? reject(error) : resolve(opened));
  });
  const exec = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
  const get = sql => new Promise((resolve, reject) => db.get(sql, (error, row) => error ? reject(error) : resolve(row)));
  try {
    if (mode === "create") {
      assert.equal(process.arch, "ia32");
      await exec("PRAGMA user_version=2; CREATE TABLE fixture(id TEXT PRIMARY KEY,payload TEXT NOT NULL); INSERT INTO fixture VALUES('pending','synthetic unsent task');");
    } else {
      assert.equal(process.arch, "x64");
      assert.equal((await get("PRAGMA user_version")).user_version, 2);
      assert.equal((await get("SELECT payload FROM fixture WHERE id='pending'")).payload, "synthetic unsent task");
      await exec("INSERT INTO fixture VALUES('new','synthetic x64 edit');");
      assert.equal((await get("SELECT count(*) AS count FROM fixture")).count, 2);
    }
  } finally {
    await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  }
}
if (["create", "verify"].includes(process.argv[2])) {
  child(...process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const [oldExe, newExe] = process.argv.slice(2).map(file => path.resolve(file));
  if (!oldExe || !newExe || !fs.existsSync(oldExe) || !fs.existsSync(newExe)) throw Error("Pass old ia32 and new x64 packaged executable paths");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "thread-arch-upgrade-"));
  try {
    for (const [mode, exe] of [["create", oldExe], ["verify", newExe]]) {
      const bundle = path.join(path.dirname(exe), "resources", "app.asar");
      const run = spawnSync(exe, [__filename, mode, bundle, path.join(temp, "fixture.db")], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true,
        stdio: "inherit", timeout: 20000,
      });
      if (run.error) throw run.error;
      assert.equal(run.status, 0, mode);
    }
    console.log("PASS: ia32-created SQLite preserves schema and pending fixture data under x64");
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
}
