import { Buffer } from 'buffer';
import type { SqlDatabase, SqlValue } from './sqlite';

const { encode, decode } = require('@thread/e2ee/src/protocol');

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

  put(bucket: string, id: string, value: unknown) {
    if (typeof id !== 'string' || !id || id.length > 256)
      throw Error('INVALID_RECORD_ID');
    this.#ready(bucket).executeSync(
      'INSERT INTO records VALUES(?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET payload=excluded.payload',
      [bucket, id, encode(value)],
    );
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
    return row ? decode(bytes(row.payload)) : null;
  }

  delete(bucket: string, id: string) {
    this.#ready(bucket).executeSync(
      'DELETE FROM records WHERE bucket=? AND id=?',
      [bucket, id],
    );
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
        value: decode(bytes(row.payload)),
      }));
  }

  close() {
    const db = this.#db;
    this.#db = null;
    db?.close();
  }
}
