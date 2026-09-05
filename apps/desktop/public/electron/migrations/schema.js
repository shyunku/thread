const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const exec = (db, sql) => new Promise((resolve, reject) =>
  db.exec(sql, (error) => error ? reject(error) : resolve()));
const all = (db, sql, args = []) => new Promise((resolve, reject) =>
  db.all(sql, args, (error, rows) => error ? reject(error) : resolve(rows)));
const run = (db, sql, args = []) => new Promise((resolve, reject) =>
  db.run(sql, args, (error) => error ? reject(error) : resolve()));
const checksum = (migration) => crypto.createHash("sha256")
  .update(JSON.stringify(migration)).digest("hex");

// App version and the legacy schema-directory version are not migration versions.
// Released definitions are immutable: append a new migration.
const manifests = {
  root: [{
    version: 1,
    name: "root_schema_baseline",
    requiredTables: { users: ["uid", "username", "auth_id", "google_auth_id", "access_token", "refresh_token"] },
    statements: [],
  }],
  user: [{
    version: 1,
    name: "user_schema_baseline",
    requiredTables: {
      tasks: ["tid", "title", "memo", "done", "done_at", "created_at", "due_date", "next", "repeat_period", "repeat_start_at"],
      subtasks: ["sid", "tid", "title", "done", "done_at", "created_at", "due_date"],
      categories: ["cid", "title", "secret", "locked", "color", "created_at"],
      tasks_categories: ["tid", "cid"],
      transactions: ["type", "timestamp", "content", "block_number", "hash", "version", "block_hash"],
    },
    statements: [],
  }, {
    version: 2,
    name: "sync_metadata",
    requiredTables: {},
    statements: [
      "CREATE TABLE thread_sync_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
      "INSERT INTO thread_sync_metadata(key,value) VALUES ('protocol','1')",
    ],
  }],
};

function validate(scope, migrations, rows) {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1 || !migration.name) throw new Error("INVALID_SCHEMA_MANIFEST");
  });
  rows.forEach((row, index) => {
    if (row.scope !== scope) throw new Error("SCHEMA_SCOPE_MISMATCH");
    if (row.version !== index + 1 || row.version > migrations.length) {
      throw new Error("SCHEMA_VERSION_UNSUPPORTED: update the app; do not downgrade the database");
    }
    const migration = migrations[index];
    if (row.name !== migration.name || row.checksum !== checksum(migration)) {
      throw new Error("SCHEMA_CHECKSUM_MISMATCH");
    }
  });
}

async function history(db) {
  const tables = await all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='thread_schema_migrations'");
  if (!tables.length) return [];
  return all(db, "SELECT version,scope,name,checksum FROM thread_schema_migrations ORDER BY version");
}

async function migrate(db, scope, databasePath, migrations = manifests[scope]) {
  if (!migrations) throw new Error("UNKNOWN_SCHEMA_SCOPE");
  validate(scope, migrations, []);
  await exec(db, "PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;");
  const before = await history(db);
  validate(scope, migrations, before);
  if (before.length === migrations.length) return { version: before.length, backupPath: null };

  // SQLite VACUUM INTO creates a consistent snapshot, including committed WAL data.
  // A unique destination is never reused or overwritten. Keep backups on failure too.
  if (!databasePath || databasePath === ":memory:") throw new Error("FILE_DATABASE_REQUIRED_FOR_MIGRATION");
  const backupDir = path.join(path.dirname(path.resolve(databasePath)), "schema-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir,
    path.basename(databasePath) + "." + Date.now() + "." + crypto.randomBytes(8).toString("hex") + ".sqlite3");
  await run(db, "VACUUM INTO ?", [backupPath]);

  await exec(db, "BEGIN IMMEDIATE");
  try {
    // Another connection may have migrated while this connection made its backup.
    const applied = await history(db);
    validate(scope, migrations, applied);
    await exec(db, `CREATE TABLE IF NOT EXISTS thread_schema_migrations (
      version INTEGER PRIMARY KEY,
      scope TEXT NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at_ms INTEGER NOT NULL
    )`);
    for (const migration of migrations.slice(applied.length)) {
      for (const [table, columns] of Object.entries(migration.requiredTables || {})) {
        const quoted = table.replace(/"/g, '""');
        const actual = await all(db, 'PRAGMA table_info("' + quoted + '")');
        if (columns.some((column) => !actual.some((item) => item.name === column))) {
          throw new Error("SCHEMA_BASELINE_MISMATCH: " + table);
        }
      }
      for (const statement of migration.statements) await exec(db, statement);
      await run(db, "INSERT INTO thread_schema_migrations(version,scope,name,checksum,applied_at_ms) VALUES (?,?,?,?,?)",
        [migration.version, scope, migration.name, checksum(migration), Date.now()]);
    }
    await exec(db, "COMMIT");
    return { version: migrations.length, backupPath };
  } catch (error) {
    await exec(db, "ROLLBACK");
    throw error;
  }
}

module.exports = { migrate, manifests, validate, checksum };
