const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EncryptedStore } = require("../public/electron/e2ee/localStore");
const { bucketRows } = require("@thread/e2ee/src/bucketCache");

function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-bucket-cache-"));
  const opened = new EncryptedStore({ filename: path.join(dir, "vault.db"), key: Buffer.alloc(32, 7), scope: { environment: "development", accountId: "synthetic", vaultId: "fixture" }, create: true });
  t.after(() => { opened.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return opened;
}
// What a full read returns, for comparison with the cache.
function fresh(s, bucket) {
  const all = [];
  let after = "";
  for (;;) {
    const page = s.entries(bucket, after, 256);
    all.push(...page);
    if (page.length < 256) return all;
    after = page.at(-1).id;
  }
}

test("the store logs written ids per bucket and resets them on rollback", (t) => {
  const s = store(t);
  assert.equal(s.revision("outbox"), 0);
  s.put("outbox", "a", { n: 1 });
  s.put("outbox", "b", { n: 2 });
  s.delete("outbox", "a");
  assert.equal(s.revision("outbox"), 3);
  assert.deepEqual([...s.changedSince("outbox", 1)].sort(), ["a", "b"]);
  assert.deepEqual([...s.changedSince("outbox", 3)], []);
  assert.equal(s.changedSince("outbox", 9), null);
  assert.throws(() => s.transaction((db) => { db.put("outbox", "c", { n: 3 }); throw Error("boom"); }), /boom/);
  assert.equal(s.get("outbox", "c"), null);
  assert.equal(s.changedSince("outbox", 3), null);
});

test("cached bucket rows always match a full read through writes and rollbacks", (t) => {
  const s = store(t);
  for (let i = 0; i < 600; i++) s.put("visible", `id-${String(i).padStart(4, "0")}`, { i });
  assert.deepEqual(bucketRows(s, "visible"), fresh(s, "visible"));
  s.put("visible", "id-0005", { i: "changed" });
  s.delete("visible", "id-0010");
  s.put("visible", "id-9999", { i: "new" });
  s.put("visible", "a-first", { i: "sorted" });
  assert.deepEqual(bucketRows(s, "visible"), fresh(s, "visible"));
  // Read inside a transaction that then rolls back: nothing from it is reused.
  assert.throws(() => s.transaction((db) => {
    db.put("visible", "id-0001", { i: "rolled back" });
    assert.equal(bucketRows(db, "visible").find((row) => row.id === "id-0001").value.i, "rolled back");
    throw Error("boom");
  }), /boom/);
  assert.deepEqual(bucketRows(s, "visible"), fresh(s, "visible"));
  assert.equal(bucketRows(s, "visible").find((row) => row.id === "id-0001").value.i, 1);
});

test("closing the store drops its decoded rows", (t) => {
  const s = store(t);
  s.put("visible", "secret", { title: "private" });
  const first = bucketRows(s, "visible");
  s.close();
  assert.throws(() => bucketRows(s, "visible"), /VAULT_LOCKED/);
  assert.equal(first.length, 1);
});
