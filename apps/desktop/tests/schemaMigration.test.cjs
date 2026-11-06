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
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-schema-test-"));
  const file = path.join(dir, "test.sqlite3");
  fs.copyFileSync(path.join(__dirname, "../public/resources/root.sqlite3"), file);
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
// Synthetic next root version: a migration that adds a table.
const next = [...manifests.root, { version: 2, name: "add_fixture", statements: [
  "CREATE TABLE fixture_values (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
  "INSERT INTO fixture_values(key,value) VALUES ('kept','1')",
]}];

test("root migrations preserve users, create a restorable backup, and are idempotent", async t => {
  const { db, file } = await fixture(t);
  await exec(db, "INSERT INTO users(uid,username,auth_id,auth_hashed_pw) VALUES ('one','kept','id','')");
  const result = await migrate(db, "root", file, next);
  assert.equal(result.version, 2);
  assert.equal((await all(db, "SELECT username FROM users"))[0].username, "kept");
  assert.equal((await all(db, "SELECT value FROM fixture_values WHERE key='kept'"))[0].value, "1");
  const backup = new sqlite3.Database(result.backupPath, sqlite3.OPEN_READONLY);
  assert.equal((await all(backup, "SELECT username FROM users"))[0].username, "kept");
  assert.equal((await all(backup, "PRAGMA integrity_check"))[0].integrity_check, "ok");
  assert.equal((await all(backup, "SELECT name FROM sqlite_master WHERE name='thread_schema_migrations'")).length, 0);
  await close(backup);
  assert.equal((await migrate(db, "root", file, next)).backupPath, null);
  assert.equal((await all(db, "SELECT * FROM thread_schema_migrations")).length, 2);
});

test("the root database keeps its own scope", async t => {
  const { db, file } = await fixture(t);
  assert.equal((await migrate(db, "root", file)).version, 1);
  await assert.rejects(migrate(db, "other", file, manifests.root), /SCHEMA_SCOPE_MISMATCH/);
  await assert.rejects(migrate(db, "user", file), /UNKNOWN_SCHEMA_SCOPE/);
});

test("failed migration rolls back DDL and version, then a valid retry works", async t => {
  const { db, file } = await fixture(t);
  await migrate(db, "root", file);
  const broken = [...manifests.root, {version: 2, name: "failure", statements: [
    "CREATE TABLE partial_change(id INTEGER)", "THIS IS INVALID SQL",
  ]}];
  await assert.rejects(migrate(db, "root", file, broken));
  assert.equal((await all(db, "SELECT name FROM sqlite_master WHERE name='partial_change'")).length, 0);
  assert.equal((await all(db, "SELECT max(version) AS v FROM thread_schema_migrations"))[0].v, 1);
  const fixed = [...manifests.root, {version: 2, name: "add_field", statements: [
    "ALTER TABLE users ADD COLUMN test_value TEXT",
  ]}];
  assert.equal((await migrate(db, "root", file, fixed)).version, 2);
  await assert.rejects(migrate(db, "root", file), /SCHEMA_VERSION_UNSUPPORTED/);
});

test("changed migration checksum and invalid baseline fail without a new version", async t => {
  const { db, file } = await fixture(t);
  await migrate(db, "root", file, next);
  const changed = next.map(m => ({...m}));
  changed[0].name = "rewritten";
  await assert.rejects(migrate(db, "root", file, changed), /SCHEMA_CHECKSUM_MISMATCH/);
  const invalid = [...next, {version: 3, name: "missing", requiredTables: {missing: ["id"]}, statements: []}];
  await assert.rejects(migrate(db, "root", file, invalid), /SCHEMA_BASELINE_MISMATCH/);
  assert.equal((await all(db, "SELECT max(version) AS v FROM thread_schema_migrations"))[0].v, 2);
});

test("concurrent connections apply every version only once", async t => {
  const { db, file } = await fixture(t);
  const other = new sqlite3.Database(file);
  try {
    await Promise.all([migrate(db, "root", file, next), migrate(other, "root", file, next)]);
    assert.equal((await all(db, "SELECT * FROM thread_schema_migrations")).length, 2);
  } finally { await close(other); }
});
