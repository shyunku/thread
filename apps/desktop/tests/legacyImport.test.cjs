const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Replica, hash } = require("../public/electron/sync-v2/replica");
const {
  classify,
  planImport,
  digestTx,
} = require("../public/electron/sync-v2/legacyImport");
const row = (type, content, number, hashValue) => ({
  type,
  version: 2,
  timestamp: 1000 + number,
  block_number: number,
  hash: hashValue,
  content: Buffer.from(JSON.stringify(content)).toJSON(),
});
function fixture() {
  const committed = row(10000, { tid: "a", title: "original" }, 1, "committed");
  const pending = row(10003, { tid: "a", title: "offline" }, 2, "pending");
  const fields = {
    title: "original",
    memo: "",
    done: false,
    done_at: 0,
    due_date: 0,
    repeat_period: "",
    repeat_start_at: 0,
    created_at: 1000,
  };
  const source = {
    tasks: [{ tid: "a", ...fields, title: "offline", next: null }],
    categories: [],
    subtasks: [],
    tasks_categories: [],
    transactions: [committed, pending],
  };
  const proof = {
    userId: "u",
    epoch: "e",
    sourceChecksum: "source",
    blocks: [
      {
        number: "7",
        txHash: "committed",
        txDigest: digestTx(committed),
        txUserId: "u",
        txVersion: 2,
        txType: 10000,
      },
    ],
  };
  const base = {
    ...proof,
    baseNumber: "7",
    baseRows: {
      tasks: [{ id: "a", ...fields, sort_rank: "4294967296" }],
      categories: [],
      subtasks: [],
      taskCategories: [],
    },
  };
  return { source, proof, base };
}
test("classify by provenance, not local block number; deterministic pending import", () => {
  const { source, proof, base } = fixture();
  assert.equal(classify(source, proof, "u").base, "7");
  const plan = planImport(source, proof, base, "u");
  assert.equal(plan.records[0].decision, "committed");
  assert.equal(plan.records[1].mutation.entityId, "a");
  assert.equal(plan.records[1].mutation.changes.title, "offline");
  assert.deepEqual(planImport(source, proof, base, "u"), plan);
  assert.equal(source.tasks[0].title, "offline");
});
test("same hash different content, unlogged edits, and fork are blocked", () => {
  let { source, proof, base } = fixture();
  source.transactions[0].content = Buffer.from("{}").toJSON();
  assert.throws(() => classify(source, proof, "u"), /PROVENANCE/);
  ({ source, proof, base } = fixture());
  source.tasks[0].memo = "unlogged local-only field";
  assert.throws(() => planImport(source, proof, base, "u"), /PARITY/);
  ({ source, proof, base } = fixture());
  source.transactions.reverse();
  source.transactions[0].block_number = 1;
  source.transactions[1].block_number = 2;
  assert.throws(() => classify(source, proof, "u"), /FORK/);
});
test("recurrence and unproven whole-state replacement remain recoverable", () => {
  const { source, proof, base } = fixture();
  source.transactions[1] = row(
    0,
    { tasks: {}, categories: {} },
    2,
    "initialize"
  );
  assert.throws(
    () => planImport(source, proof, base, "u"),
    /INITIALIZE_REVIEW/
  );
  source.transactions[1] = row(
    10006,
    { tid: "a", done: true, doneAt: 2 },
    2,
    "repeat"
  );
  base.baseRows.tasks[0].repeat_period = "month";
  assert.throws(
    () => planImport(source, proof, base, "u"),
    /RECURRENCE_REVIEW/
  );
});
test("SQLite import marker, provenance and outbox are committed exactly once", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-import-test-"));
  const r = await Replica.open(path.join(dir, "u.sqlite3"), "u");
  t.after(async () => {
    await r.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const { source, proof, base } = fixture();
  await r.preserveLegacy(source, "fixture-backup");
  const payload = JSON.stringify({
    changes: [
      {
        entityType: "task",
        entityId: "a",
        operation: "create",
        version: "0",
        fields: base.baseRows.tasks[0],
      },
    ],
  });
  const cursor =
    Buffer.from(JSON.stringify({ UID: "u", Epoch: "e", Seq: "0" })).toString(
      "base64url"
    ) + ".fixture";
  await r.installSnapshot(
    {
      epoch: "e",
      seq: "0",
      cursor,
      pageCount: 1,
      expiresAt: Date.now() + 10000,
    },
    [{ payload, checksum: hash(payload) }]
  );
  const plan = planImport(source, proof, base, "u");
  await r.acceptImport(plan);
  await r.acceptImport(plan);
  assert.equal((await r.view()).pending.length, 1);
  assert.equal((await r.next()).clientChangeId, plan.records[1].changeId);
  assert.equal((await r.view()).rows[0].fields.title, "offline");
  assert.equal(await r.meta("importComplete"), "true");
  assert.equal((await r.legacySource()).transactions.length, 2);
});
