// The small synchronous SQLite surface the vault needs. On the device this is
// op-sqlite (SQLCipher build); tests use better-sqlite3 behind the same shape.
export type SqlValue = string | number | null | Uint8Array | ArrayBuffer;
export type SqlRow = Record<string, SqlValue>;

export interface SqlDatabase {
  executeSync(sql: string, params?: SqlValue[]): { rows: SqlRow[] };
  close(): void;
}

export type OpenDatabase = (options: {
  name: string;
  // 32-byte key; omitted for the plain metadata database.
  key?: Uint8Array;
}) => SqlDatabase;
