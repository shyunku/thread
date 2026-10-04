/// <reference types="node" />
// Test stand-in for op-sqlite: node:sqlite files in a temp folder. SQLCipher is
// simulated by remembering each file's key and refusing to open it with another.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OpenDatabase, SqlRow, SqlValue } from '@/core/vault/sqlite';

const { DatabaseSync } = require('node:sqlite');

export function createTestDatabases() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-vault-test-'));
  const keys = new Map<string, string | null>();
  const opened: string[] = [];
  const handles: { close(): void }[] = [];
  const openDatabase: OpenDatabase = ({ name, key }) => {
    const keyHex = key ? Buffer.from(key).toString('hex') : null;
    if (keys.has(name) && keys.get(name) !== keyHex) {
      return {
        executeSync: () => {
          throw Error('file is not a database');
        },
        close: () => {},
      };
    }
    keys.set(name, keyHex);
    opened.push(name);
    const db = new DatabaseSync(path.join(dir, name));
    handles.push(db);
    return {
      executeSync: (sql: string, params: SqlValue[] = []) => ({
        rows: db.prepare(sql).all(...(params as any[])) as SqlRow[],
      }),
      close: () => db.close(),
    };
  };
  return {
    openDatabase,
    opened,
    cleanup: () => {
      // Close anything a test left open so Windows lets the folder go.
      for (const handle of handles) {
        try {
          handle.close();
        } catch {}
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
