const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadService(initialize) {
  class Context {
    initializeAsRoot() { return initialize(); }
    initialize() { return initialize(); }
  }
  const sandbox = {
    module: {exports: {}},
    require: name => name === "../contexts/database.context" ? Context
      : name === "path" || name === "fs" ? require(name) : {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/electron/service/database.service.js"), "utf8"), sandbox);
  return new sandbox.module.exports();
}

test("root and user DB callers wait for migration completion and share initialization", async () => {
  for (const root of [true, false]) {
    let calls = 0, finish;
    const waiting = new Promise(resolve => {finish = resolve});
    const service = loadService(async () => { calls++; await waiting; });
    const get = () => root ? service.getRootDatabaseContext() : service.getUserDatabaseContext("fixture");
    let ready = false;
    const first = get().then(value => {ready = true; return value;});
    const second = get();
    await Promise.resolve();
    assert.equal(ready, false);
    assert.equal(calls, 1);
    finish();
    assert.equal(await first, await second);
    assert.equal(await get(), await first);
  }
});

test("failed initialization is not published and can be retried", async () => {
  for (const root of [true, false]) {
    let fail = true;
    const service = loadService(async () => { if (fail) throw new Error("migration failed"); });
    const get = () => root ? service.getRootDatabaseContext() : service.getUserDatabaseContext("fixture");
    await assert.rejects(get(), /migration failed/);
    assert.equal(service.rootDatabaseContext, null);
    assert.equal(service.userDatabaseContexts.size, 0);
    fail = false;
    assert.ok(await get());
  }
});
