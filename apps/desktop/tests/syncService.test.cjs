const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const sqlite3 = require("../node_modules/sqlite3");
const { hash } = require("../public/electron/sync-v2/replica");

test("desktop service connects the v2 wire, recovers a lost ACK, blocks legacy clear", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-service-test-"));
  const uid = "fixture",
    epoch = "00000000-0000-4000-8000-000000000001",
    events = [],
    logs = [],
    sent = [];
  const caps = { protocolVersion: 2, mode: "v2", epoch, enabled: true };
  const cursor = (n) =>
    Buffer.from(
      JSON.stringify({ UID: uid, Epoch: epoch, Seq: String(n) })
    ).toString("base64url") + ".fixture";
  const initial = {
    entityType: "task",
    entityId: "a",
    operation: "create",
    version: "0",
    fields: {
      title: "original",
      sort_rank: "4294967296",
      done: false,
      created_at: 1,
    },
  };
  let dropped = false;
  const fakeAxios = async (config) => {
    const url = new URL(config.url),
      route = url.pathname.replace("/v2/sync", "");
    let data;
    if (route === "/capabilities") data = caps;
    else if (route === "/devices") data = { deviceId: config.data.deviceId };
    else if (route === "/snapshots")
      data = {
        snapshotId: "s",
        epoch,
        seq: "0",
        cursor: cursor(0),
        pageCount: 1,
        expiresAt: Date.now() + 60000,
      };
    else if (route === "/snapshots/s/pages/0") {
      const payload = JSON.stringify({ changes: [initial] });
      data = { payload, checksum: hash(payload) };
    } else if (route === "/changes") {
      const after = JSON.parse(
        Buffer.from(url.searchParams.get("after").split(".")[0], "base64url")
      ).Seq;
      data = {
        epoch,
        entries: logs.filter((e) => BigInt(e.seq) > BigInt(after)),
        nextCursor: cursor(logs.length),
        highWatermark: String(logs.length),
        hasMore: false,
        until: cursor(logs.length),
      };
    } else if (route === "/push") {
      sent.push(config.data);
      const m = config.data.mutations[0];
      assert.equal(m.localTime, undefined);
      logs.push({
        seq: "1",
        deviceId: config.data.deviceId,
        clientChangeId: m.clientChangeId,
        payload: {
          changes: [
            {
              ...initial,
              operation: "patch",
              version: "1",
              fields: { title: m.changes.title },
            },
          ],
        },
      });
      if (!dropped) {
        dropped = true;
        throw Error("lost response");
      }
      data = { results: [{ status: "accepted", seq: "1" }] };
    } else throw Error("unexpected route " + route);
    return { data };
  };
  class FakeWS extends EventEmitter {
    close() {
      if (!this.closed) {
        this.closed = true;
        this.emit("close");
      }
    }
  }
  const original = Module._load;
  Module._load = function (request, parent, ...rest) {
    if (
      request === "../modules/filesystem" &&
      parent.filename.endsWith("sync-v2" + path.sep + "service.js")
    )
      return { getUserDataPath: () => dir };
    if (
      request === "../modules/util" &&
      parent.filename.endsWith("sync-v2" + path.sep + "service.js")
    )
      return { getServerFinalEndpoint: () => "http://fixture/v1" };
    if (request === "axios") return fakeAxios;
    if (request === "ws") return FakeWS;
    return original.call(this, request, parent, ...rest);
  };
  let SyncV2Service;
  try {
    ({ SyncV2Service } = require("../public/electron/sync-v2/service"));
  } finally {
    Module._load = original;
  }
  const legacy = await new Promise((resolve, reject) => {
    const d = new sqlite3.Database(":memory:", (e) =>
      e ? reject(e) : resolve(d)
    );
  });
  await new Promise((resolve, reject) =>
    legacy.exec(
      ["tasks", "subtasks", "categories", "tasks_categories", "transactions"]
        .map((n) => "CREATE TABLE " + n + " (fixture TEXT)")
        .join(";"),
      (e) => (e ? reject(e) : resolve())
    )
  );
  const service = new SyncV2Service();
  service.inject({
    userService: { getCurrent: () => uid },
    syncerService: { userSyncerContexts: new Map() },
    databaseService: { getUserDatabaseContext: async () => ({ db: legacy }) },
    ipcService: { sender: (...event) => events.push(event) },
  });
  t.after(async () => {
    for (const s of service.sessions.values()) {
      service.stop(s);
      await s.replica.close();
    }
    await new Promise((resolve) => legacy.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await service.activate(uid, "fixture-token", caps);
  const s = service.sessions.get(uid);
  assert.equal(s.connected, true);
  assert.equal(
    await service.intercept("task/updateTaskTitle", "request", [
      "a",
      "offline",
    ]),
    true
  );
  for (let n = 0; s.running && n < 100; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(s.running, false);
  assert.equal(sent.length, 1);
  const pending = await s.replica.next();
  assert.equal(pending.clientChangeId, sent[0].mutations[0].clientChangeId);
  await s.run();
  assert.equal(sent.length, 1);
  assert.equal((await s.replica.view()).pending.length, 0);
  assert.equal((await s.replica.view()).rows[0].fields.title, "offline");
  assert.equal(
    await service.intercept("system/clearStatePermanently", "clear", []),
    true
  );
  assert.ok(
    events.some(
      (e) => e[0] === "system/clearStatePermanently" && e[2] === false
    )
  );
  assert.ok(
    events.some(
      (e) => e[0] === "sync-v2/state" && e[3].tasks[0]?.title === "offline"
    )
  );
});
