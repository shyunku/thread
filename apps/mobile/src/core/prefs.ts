import type { OpenDatabase } from '@/core/vault/sqlite';
import type { ThemeMode } from '@/ui/theme';

// Device display preferences (same meaning as the desktop prefs slice). Not secret.
export type Prefs = {
  theme: ThemeMode;
  startTab: 'tasks' | 'calendar' | 'timeline';
  weekStart: 0 | 1;
  timeFormat: '12' | '24';
  listTodoOpen: boolean;
  listDoneOpen: boolean;
  sort: 'due' | 'importance' | 'remaining' | 'created';
  // When an opened secret category locks again (#88): app closed/locked, or each visit.
  secretRelock: 'session' | 'each';
  // Show the patch notes once after an update (#99), and the last version shown
  // ('' = not recorded yet).
  showPatchNotes: boolean;
  patchNotesSeen: string;
};

export const defaultPrefs: Prefs = Object.freeze({
  theme: 'system',
  startTab: 'tasks',
  weekStart: 0,
  timeFormat: '12',
  listTodoOpen: true,
  listDoneOpen: false,
  sort: 'due',
  secretRelock: 'session',
  showPatchNotes: true,
  patchNotesSeen: '',
});

const valid: { [K in keyof Prefs]: (value: unknown) => boolean } = {
  theme: v => v === 'system' || v === 'dark' || v === 'light',
  startTab: v => v === 'tasks' || v === 'calendar' || v === 'timeline',
  weekStart: v => v === 0 || v === 1,
  timeFormat: v => v === '12' || v === '24',
  listTodoOpen: v => typeof v === 'boolean',
  listDoneOpen: v => typeof v === 'boolean',
  sort: v =>
    v === 'due' || v === 'importance' || v === 'remaining' || v === 'created',
  secretRelock: v => v === 'session' || v === 'each',
  showPatchNotes: v => typeof v === 'boolean',
  patchNotesSeen: v =>
    typeof v === 'string' &&
    (v === '' || /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)),
};

export function sanitize(raw: unknown): Prefs {
  const value: any = raw && typeof raw === 'object' ? raw : {};
  const out: any = { ...defaultPrefs };
  for (const key of Object.keys(valid) as (keyof Prefs)[])
    if (valid[key](value[key])) out[key] = value[key];
  return out;
}

export function createPrefsStore(openDatabase: OpenDatabase) {
  const withDb = <T>(operation: (db: ReturnType<OpenDatabase>) => T): T => {
    const db = openDatabase({ name: 'thread-prefs.db' });
    try {
      db.executeSync(
        'CREATE TABLE IF NOT EXISTS prefs(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)',
      );
      return operation(db);
    } finally {
      db.close();
    }
  };
  return {
    load(): Prefs {
      try {
        const row = withDb(
          db => db.executeSync('SELECT value FROM prefs WHERE id=1').rows[0],
        );
        return sanitize(row ? JSON.parse(String(row.value)) : null);
      } catch {
        return { ...defaultPrefs };
      }
    },
    save(prefs: Prefs) {
      withDb(db =>
        db.executeSync(
          'INSERT INTO prefs(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
          [JSON.stringify(sanitize(prefs))],
        ),
      );
    },
  };
}
