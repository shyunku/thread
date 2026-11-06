const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

function loadService(initialize, userDataPath = null) {
  class Context {
    initializeAsRoot() { return initialize(); }
  }
  const sandbox = {
    module: {exports: {}},
    require: name => name === "../contexts/database.context" ? Context
      : name === "../modules/filesystem" ? {getUserDataPath: () => userDataPath}
      : name === "../../../package.json" ? {config: {scheme_version: 2}}
      : name === "path" || name === "fs" ? require(name) : {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/electron/service/database.service.js"), "utf8"), sandbox);
  return new sandbox.module.exports();
}

test("root DB callers wait for migration completion and share initialization", async () => {
  let calls = 0, finish;
  const waiting = new Promise(resolve => {finish = resolve});
  const service = loadService(async () => { calls++; await waiting; });
  const get = () => service.getRootDatabaseContext();
  let ready = false;
  const first = get().then(value => {ready = true; return value;});
  const second = get();
  await Promise.resolve();
  assert.equal(ready, false);
  assert.equal(calls, 1);
  finish();
  assert.equal(await first, await second);
  assert.equal(await get(), await first);
});

test("failed initialization is not published and can be retried", async () => {
  let fail = true;
  const service = loadService(async () => { if (fail) throw new Error("migration failed"); });
  await assert.rejects(service.getRootDatabaseContext(), /migration failed/);
  assert.equal(service.rootDatabaseContext, null);
  fail = false;
  assert.ok(await service.getRootDatabaseContext());
});

test("account deletion removes only this account's old plaintext databases", async t => {
  // Synthetic files in a temp directory; no user data.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-remove-user-db-"));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = (...parts) => {
    const target = path.join(dir, "datafiles", ...parts);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, "fixture");
    return target;
  };
  const removed = [file("v1", "user-a b.sqlite3"), file("v2", "user-a b.sqlite3"), file("v2", "user-a b.sqlite3-wal"),
    file("sync-v2", "user-a%20b.sqlite3"), file("sync-v2", "user-a%20b.sqlite3-wal"), file("sync-v2", "user-a%20b.sqlite3-shm")];
  const kept = [file("root-v1.sqlite3"), file("v2", "user-other.sqlite3"), file("sync-v2", "user-other.sqlite3"),
    file("sync-v2", "legacy-fixture.sqlite3")];
  const service = loadService(async () => {}, dir);
  await service.removeUserDatabases("a b");
  for (const target of removed) assert.equal(fs.existsSync(target), false, target);
  for (const target of kept) assert.equal(fs.existsSync(target), true, target);
  await assert.rejects(service.removeUserDatabases("../a"), /User ID is not valid/);
  await assert.rejects(service.removeUserDatabases("a" + String.fromCharCode(92) + "b"), /User ID is not valid/);
});
