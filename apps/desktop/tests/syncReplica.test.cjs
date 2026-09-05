const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  Replica,
  hash,
  identity,
} = require("../public/electron/sync-v2/replica");
const cursor = (n) =>
  Buffer.from(
    JSON.stringify({ UID: "fixture", Epoch: "epoch", Seq: n })
  ).toString("base64url") + ".signed";
const task = (id, title = id) => ({
  entityType: "task",
  entityId: id,
  operation: "create",
  version: "1",
  fields: { title, sort_rank: "4294967296", created_at: 1, done: false },
});
const snapshot = (seq, changes) => {
  const payload = JSON.stringify({ changes });
  return [
    {
      epoch: "epoch",
      seq,
      cursor: cursor(seq),
      pageCount: 1,
      expiresAt: Date.now() + 60000,
    },
    [{ payload, checksum: hash(payload) }],
  ];
};
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-replica-test-")),
    file = path.join(dir, "fixture.sqlite3");
  let r = await Replica.open(file, "fixture");
  t.after(async () => {
    await r.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    get r() {
      return r;
    },
    reopen: async () => {
      await r.close();
      r = await Replica.open(file, "fixture");
      return r;
    },
  };
}
test("durable offline edit and stable retry survive reopen without cursor advance", async (t) => {
  const f = await fixture(t),
    r = f.r;
  await r.installSnapshot(...snapshot("1", [task("one")]));
  const id = await r.enqueue({
    entityType: "task",
    entityId: "one",
    operation: "patch",
    changes: { title: "offline" },
  });
  assert.equal((await r.view()).rows[0].fields.title, "offline");
  const request = await r.next();
  assert.equal(request.clientChangeId, id);
  assert.ok(!Object.hasOwn(request, "localTime"));
  await f.reopen();
  assert.deepEqual(await f.r.next(), request);
  await f.r.acknowledge(id, { status: "accepted", seq: "3" });
  assert.equal((await f.r.view()).seq, "1");
  assert.equal((await f.r.view()).rows[0].fields.title, "offline");
  await f.r.applyPage({
    epoch: "epoch",
    entries: [
      {
        seq: "2",
        deviceId: "other",
        clientChangeId: "other",
        payload: {
          changes: [
            {
              ...task("one"),
              version: "2",
              operation: "patch",
              fields: { memo: "remote" },
            },
          ],
        },
      },
    ],
    nextCursor: cursor("2"),
    hasMore: true,
    highWatermark: "3",
  });
  assert.equal((await f.r.view()).rows[0].fields.title, "offline");
  const view = await f.r.view();
  await f.r.applyPage({
    epoch: "epoch",
    entries: [
      {
        seq: "3",
        deviceId: request.deviceId,
        clientChangeId: id,
        payload: {
          changes: [
            {
              ...task("one"),
              version: "3",
              operation: "patch",
              fields: { title: "offline" },
            },
          ],
        },
      },
    ],
    nextCursor: cursor("3"),
    hasMore: false,
    highWatermark: "3",
  });
  assert.equal((await f.r.view()).pending.length, 0);
  assert.equal((await f.r.view()).rows[0].fields.memo, "remote");
  assert.equal(view.seq, "2");
});
test("snapshot reset preserves unknown ACK pending; reject preserves recovery original", async (t) => {
  const { r } = await fixture(t);
  await r.installSnapshot(...snapshot("1", [task("one")]));
  const id = await r.enqueue({
    entityType: "task",
    entityId: "one",
    operation: "patch",
    changes: { title: "pending" },
  });
  await r.installSnapshot(
    ...snapshot("4", [{ ...task("one", "server"), version: "4" }])
  );
  assert.equal((await r.view()).rows[0].fields.title, "pending");
  assert.equal((await r.next()).clientChangeId, id);
  await r.acknowledge(id, {
    status: "rejected",
    code: "ENTITY_DELETED",
    seq: "4",
  });
  assert.equal((await r.view()).rows[0].fields.title, "server");
  assert.deepEqual((await r.view()).recovery, [
    { id, reason: "ENTITY_DELETED" },
  ]);
});
test("gap/checksum/transaction failure keeps both prefix and pending", async (t) => {
  const { r } = await fixture(t);
  await r.installSnapshot(...snapshot("1", [task("one")]));
  await r.enqueue({
    entityType: "task",
    entityId: "one",
    operation: "patch",
    changes: { title: "pending" },
  });
  const before = await r.view();
  await assert.rejects(
    r.applyPage({
      epoch: "epoch",
      entries: [{ seq: "3", payload: { changes: [] } }],
    }),
    /LOG_GAP/
  );
  const [s, p] = snapshot("2", []);
  p[0].checksum = "wrong";
  await assert.rejects(r.installSnapshot(s, p), /SNAPSHOT_CHECKSUM/);
  await new Promise((resolve, reject) =>
    r.db.exec(
      "CREATE TRIGGER fail_cursor BEFORE UPDATE ON sync_meta WHEN NEW.key='cursor' BEGIN SELECT RAISE(ABORT,'fixture'); END",
      (e) => (e ? reject(e) : resolve())
    )
  );
  await assert.rejects(r.installSnapshot(...snapshot("2", [])), /fixture/);
  assert.deepEqual(await r.view(), before);
});
test("legacy preservation is idempotent; nonempty source gates migration and editing", async (t) => {
  const { r } = await fixture(t);
  const source = {
    tasks: [{ tid: "legacy", title: "keep" }],
    transactions: [{ hash: "pending", content: "original" }],
  };
  await r.preserveLegacy(source, "fixture-backup.sqlite3");
  await r.preserveLegacy(source, "fixture-backup.sqlite3");
  await r.installSnapshot(...snapshot("1", [task("one")]));
  assert.equal((await r.view()).recovery.length, 1);
  await assert.rejects(
    r.enqueue({ entityType: "task", entityId: "one", operation: "delete" }),
    /LEGACY_REVIEW_REQUIRED/
  );
  await assert.rejects(
    r.preserveLegacy({ tasks: [] }, "another"),
    /LEGACY_SOURCE_CHANGED/
  );
});
test("epoch change with pending does not rebind queued identity", async (t) => {
  const { r } = await fixture(t);
  await r.installSnapshot(...snapshot("1", [task("one")]));
  await r.enqueue({
    entityType: "task",
    entityId: "one",
    operation: "patch",
    changes: { title: "keep" },
  });
  const [s, p] = snapshot("2", []);
  s.epoch = "other";
  s.cursor =
    Buffer.from(
      JSON.stringify({ UID: "fixture", Epoch: "other", Seq: "2" })
    ).toString("base64url") + ".fixture";
  await assert.rejects(r.installSnapshot(s, p), /EPOCH_CHANGED_WITH_PENDING/);
  assert.equal((await r.next()).epoch, "epoch");
});
