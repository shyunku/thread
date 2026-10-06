const fs = require("node:fs");
const Database = require("better-sqlite3-multiple-ciphers");
const { encode, decode, decodeStored } = require("./protocol");
const BUCKETS = new Set(["confirmed", "visible", "outbox", "recovery", "search"]);
const WRITE_LOG = 4096;
class EncryptedStore {
  #db;
  #scope;
  constructor({ filename, key, scope, create = false, readonly = false }) {
    if (create && readonly) throw Error("READONLY_CREATE_FORBIDDEN");
    if (!Buffer.isBuffer(key) || key.length !== 32) throw Error("INVALID_LDK");
    if (!scope || !["development", "production"].includes(scope.environment) ||
        typeof scope.accountId !== "string" || !scope.accountId ||
        typeof scope.vaultId !== "string" || !scope.vaultId) throw Error("INVALID_STORE_SCOPE");
    if (create) fs.closeSync(fs.openSync(filename, "wx", 0o600));
    else if (!fs.existsSync(filename) || fs.statSync(filename).size === 0) throw Error("VAULT_MISSING");
    let db;
    try {
      db = new Database(filename, { fileMustExist: true, readonly });
      db.pragma("cipher='chacha20'");
      db.key(key);
      db.pragma("temp_store=MEMORY");
      db.pragma("mmap_size=0");
      const version = db.pragma("user_version", { simple: true });
      if (!create && version !== 1) throw Error("UNSUPPORTED_STORE_SCHEMA");
      if (create) db.transaction(() => {
        db.exec("CREATE TABLE vault_meta(id INTEGER PRIMARY KEY CHECK(id=1),scope BLOB NOT NULL); CREATE TABLE records(bucket TEXT NOT NULL,id TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(bucket,id)); PRAGMA user_version=1");
        db.prepare("INSERT INTO vault_meta VALUES(1,?)").run(encode(scope));
      })();
      const pinned = db.prepare("SELECT scope FROM vault_meta WHERE id=1").get();
      if (!pinned || !Buffer.from(pinned.scope).equals(encode(scope))) throw Error("STORE_SCOPE_MISMATCH");
      if (!readonly) { db.pragma("journal_mode=WAL"); db.pragma("synchronous=FULL"); }
      this.#db = db;
      this.#scope = decode(encode(scope));
    } catch (error) { db?.close(); throw error; } // Never delete or reset on bad keys.
  }
  #ready(bucket) {
    if (!this.#db) throw Error("VAULT_LOCKED");
    if (!BUCKETS.has(bucket)) throw Error("INVALID_BUCKET");
    return this.#db;
  }
  // Writes per bucket in this session, with a short log of written ids, for caches of
  // decoded rows (packages/e2ee bucketCache, #98). A rolled-back transaction counts as a
  // reset of every bucket, so nothing read inside it can be reused afterwards.
  #writes = new Map();
  #log = new Map();
  revision(bucket) { return this.#writes.get(bucket) ?? 0; }
  #wrote(bucket, id) {
    const revision = this.revision(bucket) + 1;
    this.#writes.set(bucket, revision);
    let log = this.#log.get(bucket);
    if (!log) this.#log.set(bucket, (log = []));
    log.push({ revision, id });
    if (log.length > WRITE_LOG) log.splice(0, log.length - WRITE_LOG);
  }
  // Ids written after `revision`, or null when unknown (log trimmed, rollback, other store).
  changedSince(bucket, revision) {
    const current = this.revision(bucket);
    if (!Number.isInteger(revision) || revision > current) return null;
    if (revision === current) return new Set();
    const log = this.#log.get(bucket) || [];
    if (!log.length || log[0].revision > revision + 1) return null;
    const ids = new Set();
    for (const entry of log) {
      if (entry.revision <= revision) continue;
      if (entry.id === null) return null;
      ids.add(entry.id);
    }
    return ids;
  }
  put(bucket, id, value) {
    if (typeof id !== "string" || !id || id.length > 256) throw Error("INVALID_RECORD_ID");
    this.#ready(bucket).prepare("INSERT INTO records VALUES(?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET payload=excluded.payload").run(bucket,id,encode(value));
    this.#wrote(bucket, id);
  }
  scope() { this.#ready("confirmed"); return decode(encode(this.#scope)); }
  get(bucket, id) {
    const row = this.#ready(bucket).prepare("SELECT payload FROM records WHERE bucket=? AND id=?").get(bucket,id);
    return row ? decodeStored(Buffer.from(row.payload)) : null;
  }
  delete(bucket,id) { this.#ready(bucket).prepare("DELETE FROM records WHERE bucket=? AND id=?").run(bucket,id); this.#wrote(bucket, id); }
  transaction(operation) {
    const db = this.#ready("visible");
    try {
      return db.transaction(() => {
        const result = operation(this);
        if (result && typeof result.then === "function") throw Error("ASYNC_TRANSACTION_FORBIDDEN");
        return result;
      })();
    } catch (error) {
      for (const bucket of BUCKETS) this.#wrote(bucket, null);
      throw error;
    }
  }
  entries(bucket, after = "", limit = 100) {
    if (typeof after !== "string" || !Number.isInteger(limit) || limit < 1 || limit > 256) throw Error("INVALID_PAGE");
    return this.#ready(bucket).prepare("SELECT id,payload FROM records WHERE bucket=? AND id>? ORDER BY id LIMIT ?").all(bucket,after,limit)
      .map(row=>({id:row.id,value:decodeStored(Buffer.from(row.payload))}));
  }
  close() { const db = this.#db; this.#db = null; require("@thread/e2ee/src/bucketCache").forgetBucketRows(this); db?.close(); }
}
class VaultSession {
  #store = null;
  #generation = 0;
  #pending = false;
  constructor({ reauthenticate, openStore, clearRenderer }) {
    this.reauthenticate = reauthenticate; this.openStore = openStore; this.clearRenderer = clearRenderer;
  }
  async unlock(request) {
    if (this.#pending) throw Error("UNLOCK_IN_PROGRESS");
    this.#pending = true;
    const generation = this.#generation;
    try {
      if (await this.reauthenticate(request) !== true) throw Error("REAUTH_REQUIRED");
      if (generation !== this.#generation) throw Error("UNLOCK_CANCELLED");
      const store = await this.openStore(request);
      if (generation !== this.#generation) { store.close(); throw Error("UNLOCK_CANCELLED"); }
      this.#store?.close(); this.#store = store;
    } finally { this.#pending = false; }
  }
  use(operation) {
    if (!this.#store) throw Error("VAULT_LOCKED");
    return operation(this.#store);
  }
  lock() {
    this.#generation++;
    const store = this.#store; this.#store = null;
    try { store?.close(); } finally { this.clearRenderer(); }
  }
  watch(powerMonitor) {
    const lock = () => this.lock();
    powerMonitor.on("lock-screen", lock); powerMonitor.on("suspend", lock);
    return () => { powerMonitor.removeListener("lock-screen",lock); powerMonitor.removeListener("suspend",lock); this.lock(); };
  }
}
module.exports = { EncryptedStore, VaultSession };
