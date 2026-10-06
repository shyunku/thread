import { Buffer } from 'buffer';
import type { SqlDatabase, SqlValue } from './sqlite';

const { encode, decode, decodeStored } = require('@thread/e2ee/src/protocol');

// Same record model and API as the desktop EncryptedStore
// (apps/desktop/public/electron/e2ee/localStore.js), so the shared replica and
// synchronizer run unchanged. The whole database file is encrypted (SQLCipher).
const BUCKETS = new Set([
  'confirmed',
  'visible',
  'outbox',
  'recovery',
  'search',
]);
const WRITE_LOG = 4096;

export type StoreScope = {
  environment: 'development' | 'production';
  accountId: string;
  vaultId: string;
};

export function validScope(scope: StoreScope): boolean {
  return (
    !!scope &&
    ['development', 'production'].includes(scope.environment) &&
    typeof scope.accountId === 'string' &&
    scope.accountId.length > 0 &&
    typeof scope.vaultId === 'string' &&
    scope.vaultId.length > 0
  );
}

function bytes(value: SqlValue): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw Error('INVALID_STORE_VALUE');
}

export class EncryptedStore {
  #db: SqlDatabase | null;
  #scope: StoreScope;
  #depth = 0;

  constructor({
    db,
    scope,
    create = false,
  }: {
    db: SqlDatabase;
    scope: StoreScope;
    create?: boolean;
  }) {
    if (!validScope(scope)) throw Error('INVALID_STORE_SCOPE');
    try {
      // A wrong key fails here: SQLCipher cannot read the schema.
      const version = Number(
        db.executeSync('PRAGMA user_version').rows[0]?.user_version ?? 0,
      );
      if (create) {
        if (version !== 0) throw Error('VAULT_EXISTS');
        db.executeSync('BEGIN IMMEDIATE');
        try {
          db.executeSync(
            'CREATE TABLE vault_meta(id INTEGER PRIMARY KEY CHECK(id=1),scope BLOB NOT NULL)',
          );
          db.executeSync(
            'CREATE TABLE records(bucket TEXT NOT NULL,id TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(bucket,id))',
          );
          db.executeSync('INSERT INTO vault_meta VALUES(1,?)', [encode(scope)]);
          db.executeSync('PRAGMA user_version=1');
          db.executeSync('COMMIT');
        } catch (error) {
          db.executeSync('ROLLBACK');
          throw error;
        }
      } else if (version !== 1) throw Error('UNSUPPORTED_STORE_SCHEMA');
      const pinned = db.executeSync('SELECT scope FROM vault_meta WHERE id=1')
        .rows[0];
      if (!pinned || !bytes(pinned.scope).equals(encode(scope)))
        throw Error('STORE_SCOPE_MISMATCH');
      db.executeSync('PRAGMA journal_mode=WAL');
      db.executeSync('PRAGMA synchronous=FULL');
      db.executeSync('PRAGMA temp_store=MEMORY');
      this.#db = db;
      this.#scope = decode(encode(scope));
    } catch (error) {
      db.close(); // Never delete or reset on a bad key.
      throw error;
    }
  }

  #ready(bucket: string): SqlDatabase {
    if (!this.#db) throw Error('VAULT_LOCKED');
    if (!BUCKETS.has(bucket)) throw Error('INVALID_BUCKET');
    return this.#db;
  }

  // Writes per bucket in this session: screens rebuild their view only when the
  // bucket they read changed, and the shared replica reuses its decoded outbox. A
  // rolled-back transaction counts as a write to every bucket, so nothing read inside
  // it is reused afterwards.
  #writes = new Map<string, number>();
  #log = new Map<string, { revision: number; id: string | null }[]>();
  revision(bucket: string): number {
    return this.#writes.get(bucket) ?? 0;
  }
  #wrote(bucket: string, id: string | null) {
    const revision = this.revision(bucket) + 1;
    this.#writes.set(bucket, revision);
    let log = this.#log.get(bucket);
    if (!log) this.#log.set(bucket, (log = []));
    log.push({ revision, id });
    if (log.length > WRITE_LOG) log.splice(0, log.length - WRITE_LOG);
  }
  // Ids written after `revision` (for the shared decoded-bucket cache, #98), or null
  // when unknown: the log was trimmed or a transaction rolled back.
  changedSince(bucket: string, revision: number): Set<string> | null {
    const current = this.revision(bucket);
    if (!Number.isInteger(revision) || revision > current) return null;
    if (revision === current) return new Set();
    const log = this.#log.get(bucket) ?? [];
    if (!log.length || log[0].revision > revision + 1) return null;
    const ids = new Set<string>();
    for (const entry of log) {
      if (entry.revision <= revision) continue;
      if (entry.id === null) return null;
      ids.add(entry.id);
    }
    return ids;
  }

  put(bucket: string, id: string, value: unknown) {
    if (typeof id !== 'string' || !id || id.length > 256)
      throw Error('INVALID_RECORD_ID');
    this.#ready(bucket).executeSync(
      'INSERT INTO records VALUES(?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET payload=excluded.payload',
      [bucket, id, encode(value)],
    );
    this.#wrote(bucket, id);
  }

  scope(): StoreScope {
    this.#ready('confirmed');
    return decode(encode(this.#scope));
  }

  get(bucket: string, id: string) {
    const row = this.#ready(bucket).executeSync(
      'SELECT payload FROM records WHERE bucket=? AND id=?',
      [bucket, id],
    ).rows[0];
    return row ? decodeStored(bytes(row.payload)) : null;
  }

  delete(bucket: string, id: string) {
    this.#ready(bucket).executeSync(
      'DELETE FROM records WHERE bucket=? AND id=?',
      [bucket, id],
    );
    this.#wrote(bucket, id);
  }

  // Synchronous like better-sqlite3's transaction(); nested calls become savepoints.
  transaction<T>(operation: (store: EncryptedStore) => T): T {
    const db = this.#ready('visible');
    const savepoint = `sp${this.#depth}`;
    db.executeSync(
      this.#depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`,
    );
    this.#depth++;
    try {
      const result = operation(this);
      if (result && typeof (result as any).then === 'function')
        throw Error('ASYNC_TRANSACTION_FORBIDDEN');
      this.#depth--;
      db.executeSync(this.#depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      for (const bucket of BUCKETS) this.#wrote(bucket, null);
      this.#depth--;
      if (this.#depth === 0) db.executeSync('ROLLBACK');
      else {
        db.executeSync(`ROLLBACK TO ${savepoint}`);
        db.executeSync(`RELEASE ${savepoint}`);
      }
      throw error;
    }
  }

  entries(bucket: string, after = '', limit = 100) {
    if (
      typeof after !== 'string' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 256
    ) {
      throw Error('INVALID_PAGE');
    }
    return this.#ready(bucket)
      .executeSync(
        'SELECT id,payload FROM records WHERE bucket=? AND id>? ORDER BY id LIMIT ?',
        [bucket, after, limit],
      )
      .rows.map(row => ({
        id: String(row.id),
        value: decodeStored(bytes(row.payload)),
      }));
  }

  close() {
    const db = this.#db;
    this.#db = null;
    // Decoded rows (plaintext) cached by the shared replica code go with the store.
    require('@thread/e2ee/src/bucketCache').forgetBucketRows(this);
    db?.close();
  }
}
