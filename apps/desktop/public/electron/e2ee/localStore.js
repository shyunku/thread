const fs = require("node:fs");
const Database = require("better-sqlite3-multiple-ciphers");
const { encode, decode } = require("./protocol");
const BUCKETS = new Set(["confirmed", "visible", "outbox", "recovery", "search"]);
class EncryptedStore {
  #db;
  constructor({ filename, key, scope, create = false }) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw Error("INVALID_LDK");
    if (!scope || !["development", "production"].includes(scope.environment) ||
        typeof scope.accountId !== "string" || !scope.accountId ||
        typeof scope.vaultId !== "string" || !scope.vaultId) throw Error("INVALID_STORE_SCOPE");
    if (create) fs.closeSync(fs.openSync(filename, "wx", 0o600));
    else if (!fs.existsSync(filename) || fs.statSync(filename).size === 0) throw Error("VAULT_MISSING");
    let db;
    try {
      db = new Database(filename, { fileMustExist: true });
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
      db.pragma("journal_mode=WAL"); db.pragma("synchronous=FULL");
      this.#db = db;
    } catch (error) { db?.close(); throw error; } // Never delete or reset on bad keys.
  }
  #ready(bucket) {
    if (!this.#db) throw Error("VAULT_LOCKED");
    if (!BUCKETS.has(bucket)) throw Error("INVALID_BUCKET");
    return this.#db;
  }
  put(bucket, id, value) {
    if (typeof id !== "string" || !id || id.length > 256) throw Error("INVALID_RECORD_ID");
    this.#ready(bucket).prepare("INSERT INTO records VALUES(?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET payload=excluded.payload").run(bucket,id,encode(value));
  }
  get(bucket, id) {
    const row = this.#ready(bucket).prepare("SELECT payload FROM records WHERE bucket=? AND id=?").get(bucket,id);
    return row ? decode(Buffer.from(row.payload)) : null;
  }
  delete(bucket,id) { this.#ready(bucket).prepare("DELETE FROM records WHERE bucket=? AND id=?").run(bucket,id); }
  transaction(operation) {
    const db = this.#ready("visible");
    return db.transaction(() => {
      const result = operation(this);
      if (result && typeof result.then === "function") throw Error("ASYNC_TRANSACTION_FORBIDDEN");
      return result;
    })();
  }
  entries(bucket, after = "", limit = 100) {
    if (typeof after !== "string" || !Number.isInteger(limit) || limit < 1 || limit > 256) throw Error("INVALID_PAGE");
    return this.#ready(bucket).prepare("SELECT id,payload FROM records WHERE bucket=? AND id>? ORDER BY id LIMIT ?").all(bucket,after,limit)
      .map(row=>({id:row.id,value:decode(Buffer.from(row.payload))}));
  }
  close() { const db = this.#db; this.#db = null; db?.close(); }
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
    const timer = setInterval(() => {
      if (powerMonitor.getSystemIdleTime() >= 300) lock();
    }, 1000);
    timer.unref?.();
    return () => { clearInterval(timer); powerMonitor.removeListener("lock-screen",lock); powerMonitor.removeListener("suspend",lock); this.lock(); };
  }
}
module.exports = { EncryptedStore, VaultSession };
