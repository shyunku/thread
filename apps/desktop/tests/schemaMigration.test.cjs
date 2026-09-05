const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sqlite3 = require("sqlite3");
const { migrate, manifests } = require("../public/electron/migrations/schema");
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, e => e ? reject(e) : resolve()));
const all = (db, sql) => new Promise((resolve, reject) => db.all(sql, (e, r) => e ? reject(e) : resolve(r)));
const close = db => new Promise((resolve, reject) => db.close(e => e ? reject(e) : resolve()));
async function fixture(t, template = "v2-template.sqlite3") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-schema-test-"));
  const file = path.join(dir, "test.sqlite3");
  fs.copyFileSync(path.join(__dirname, "../public/resources", template), file);
  const db = await new Promise((resolve, reject) => {
    const opened = new sqlite3.Database(file, e => e ? reject(e) : resolve(opened));
  });
  t.after(async () => {
    await close(db);
    // Only this test's mkdtemp directory is removed.
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { db, file, dir };
}

test("user migrations preserve tasks, create a restorable backup, and are idempotent", async t => {
  const { db, file } = await fixture(t);
  await exec(db, "INSERT INTO tasks(tid,title,created_at,memo) VALUES ('one','kept',123,'memo')");
  const result = await migrate(db, "user", file);
  assert.equal(result.version, 2);
  assert.equal((await all(db, "SELECT title,memo FROM tasks"))[0].title, "kept");
  assert.equal((await all(db, "SELECT value FROM thread_sync_metadata WHERE key='protocol'"))[0].value, "1");
  const backup = new sqlite3.Database(result.backupPath, sqlite3.OPEN_READONLY);
  assert.equal((await all(backup, "SELECT title FROM tasks"))[0].title, "kept");
  assert.equal((await all(backup, "PRAGMA integrity_check"))[0].integrity_check, "ok");
  assert.equal((await all(backup, "SELECT name FROM sqlite_master WHERE name='thread_schema_migrations'")).length, 0);
  await close(backup);
  assert.equal((await migrate(db, "user", file)).backupPath, null);
  assert.equal((await all(db, "SELECT * FROM thread_schema_migrations")).length, 2);
});

test("root database uses an independent version without touching user data", async t => {
  const { db, file } = await fixture(t, "root.sqlite3");
  assert.equal((await migrate(db, "root", file)).version, 1);
  await assert.rejects(migrate(db, "user", file), /SCHEMA_SCOPE_MISMATCH/);
});

test("failed migration rolls back DDL and version, then a valid retry works", async t => {
  const { db, file } = await fixture(t);
  await migrate(db, "user", file);
  const broken = [...manifests.user, {version: 3, name: "failure", statements: [
    "CREATE TABLE partial_change(id INTEGER)", "THIS IS INVALID SQL",
  ]}];
  await assert.rejects(migrate(db, "user", file, broken));
  assert.equal((await all(db, "SELECT name FROM sqlite_master WHERE name='partial_change'")).length, 0);
  assert.equal((await all(db, "SELECT max(version) AS v FROM thread_schema_migrations"))[0].v, 2);
  const fixed = [...manifests.user, {version: 3, name: "add_field", statements: [
    "ALTER TABLE tasks ADD COLUMN test_value TEXT",
  ]}];
  assert.equal((await migrate(db, "user", file, fixed)).version, 3);
  await assert.rejects(migrate(db, "user", file), /SCHEMA_VERSION_UNSUPPORTED/);
});

test("changed migration checksum and invalid baseline fail without a new version", async t => {
  const { db, file } = await fixture(t);
  await migrate(db, "user", file);
  const changed = manifests.user.map(m => ({...m}));
  changed[0].name = "rewritten";
  await assert.rejects(migrate(db, "user", file, changed), /SCHEMA_CHECKSUM_MISMATCH/);
  const invalid = [...manifests.user, {version: 3, name: "missing", requiredTables: {missing: ["id"]}, statements: []}];
  await assert.rejects(migrate(db, "user", file, invalid), /SCHEMA_BASELINE_MISMATCH/);
  assert.equal((await all(db, "SELECT max(version) AS v FROM thread_schema_migrations"))[0].v, 2);
});

test("concurrent connections apply every version only once", async t => {
  const { db, file } = await fixture(t);
  const other = new sqlite3.Database(file);
  try {
    await Promise.all([migrate(db, "user", file), migrate(other, "user", file)]);
    assert.equal((await all(db, "SELECT * FROM thread_schema_migrations")).length, 2);
  } finally { await close(other); }
});
