import sha256 from 'sha256';
import {Buffer} from 'buffer';

type Change = {
  entityType: string;
  entityId: string;
  parentId?: string;
  operation: string;
  version: string;
  fields: Record<string, any>;
};
type State = Record<string, Change>;
type Cache = {
  schema: 1;
  protocol: 2;
  uid: string;
  epoch: string;
  seq: string;
  cursor: string;
  rows: State;
};
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<any>;
};
type Request = (path: string, body?: any) => Promise<any>;

export function compareDecimal(a: string, b: string): number {
  if (!/^-?(0|[1-9][0-9]*)$/.test(a) || !/^-?(0|[1-9][0-9]*)$/.test(b))
    throw new Error('INVALID_DECIMAL');
  if (a === b) return 0;
  const negativeA = a[0] === '-',
    negativeB = b[0] === '-';
  if (negativeA !== negativeB) return negativeA ? -1 : 1;
  const x = negativeA ? a.slice(1) : a,
    y = negativeB ? b.slice(1) : b;
  const sign =
    x.length === y.length ? (x < y ? -1 : 1) : x.length < y.length ? -1 : 1;
  return negativeA ? -sign : sign;
}
function increment(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('INVALID_SEQ');
  const chars = value.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] !== '9') {
      chars[i] = String(Number(chars[i]) + 1);
      return chars.join('');
    }
    chars[i] = '0';
  }
  return '1' + chars.join('');
}
function validateCursor(
  cursor: string,
  uid: string,
  epoch: string,
  seq: string,
) {
  // The server verifies the signature. This local check prevents advancing the
  // cached cursor separately from its materialized prefix.
  const decoded = JSON.parse(
    Buffer.from(cursor.split('.')[0], 'base64').toString('utf8'),
  );
  if (decoded.UID !== uid || decoded.Epoch !== epoch || decoded.Seq !== seq)
    throw new Error('CURSOR_MISMATCH');
}
function key(c: Change) {
  return JSON.stringify([c.entityType, c.parentId || '', c.entityId]);
}
function apply(rows: State, changes: Change[], snapshot = false) {
  if (!Array.isArray(changes)) throw new Error('INVALID_CHANGES');
  for (const c of changes) {
    if (
      !['task', 'category', 'subtask', 'taskCategory'].includes(c.entityType) ||
      typeof c.entityId !== 'string' ||
      !c.entityId ||
      !/^(0|[1-9][0-9]*)$/.test(c.version) ||
      !c.fields ||
      Array.isArray(c.fields) ||
      !['create', 'patch', 'delete', 'upsert', 'move'].includes(c.operation)
    )
      throw new Error('INVALID_CHANGE');
    const id = key(c),
      prior = rows[id];
    if (snapshot && prior) throw new Error('DUPLICATE_ENTITY');
    if (
      !snapshot &&
      !prior &&
      c.operation === 'patch' &&
      c.entityType !== 'taskCategory'
    )
      throw new Error('MISSING_BASE');
    if (prior && compareDecimal(prior.version, c.version) > 0)
      throw new Error('VERSION_REGRESSION');
    rows[id] = {...c, fields: {...prior?.fields, ...c.fields}};
  }
}
export function toLegacy(rows: State) {
  const tasks: Record<string, any> = Object.create(null),
    categories: Record<string, any> = Object.create(null);
  const alive = Object.values(rows).filter(
    c => c.operation !== 'delete' && c.fields.deleted_at == null,
  );
  for (const c of alive) {
    const f = c.fields;
    if (c.entityType === 'category')
      categories[c.entityId] = {
        cid: c.entityId,
        title: f.title,
        secret: f.secret,
        locked: f.locked,
        color: f.color,
        createdAt: f.created_at,
      };
    if (c.entityType === 'task')
      tasks[c.entityId] = {
        tid: c.entityId,
        title: f.title,
        memo: f.memo,
        done: f.done,
        doneAt: f.done_at,
        dueDate: f.due_date,
        createdAt: f.created_at,
        repeatPeriod: f.repeat_period,
        repeatStartAt: f.repeat_start_at,
        subtasks: Object.create(null),
        categories: Object.create(null),
      };
  }
  const ordered = alive
    .filter(c => c.entityType === 'task')
    .sort(
      (a, b) =>
        compareDecimal(a.fields.sort_rank, b.fields.sort_rank) ||
        (a.entityId < b.entityId ? -1 : a.entityId === b.entityId ? 0 : 1),
    );
  ordered.forEach((c, i) => {
    tasks[c.entityId].next = ordered[i + 1]?.entityId || '';
  });
  for (const c of alive) {
    const f = c.fields,
      task = tasks[c.parentId || ''];
    if (c.entityType === 'subtask') {
      if (!task) throw new Error('MISSING_PARENT');
      task.subtasks[c.entityId] = {
        sid: c.entityId,
        title: f.title,
        done: f.done,
        doneAt: f.done_at,
        dueDate: f.due_date,
        createdAt: f.created_at,
      };
    }
    if (c.entityType === 'taskCategory' && f.present) {
      if (!task || !categories[c.entityId]) throw new Error('MISSING_CATEGORY');
      task.categories[c.entityId] = categories[c.entityId];
    }
  }
  return {tasks, categories};
}
export class ReadReplica {
  cache: Cache | null = null;
  readonly storageKey: string;
  constructor(
    readonly uid: string,
    readonly storage: Storage,
    readonly request: Request,
  ) {
    this.storageKey = 'thread:sync-v2:' + encodeURIComponent(uid);
  }
  async load() {
    const raw = await this.storage.getItem(this.storageKey);
    if (!raw) return null;
    try {
      const {payload, checksum} = JSON.parse(raw);
      if (sha256(payload) !== checksum) throw new Error('CACHE_CHECKSUM');
      const c: Cache = JSON.parse(payload);
      if (c.schema !== 1 || c.protocol !== 2 || c.uid !== this.uid || !c.rows)
        throw new Error('CACHE_SCOPE');
      validateCursor(c.cursor, c.uid, c.epoch, c.seq);
      toLegacy(c.rows);
      this.cache = c;
      return c;
    } catch {
      // Preserve unrecognized/corrupt cache bytes; do not reuse its cursor.
      await this.storage.setItem(
        this.storageKey + ':recovery:' + Date.now(),
        raw,
      );
      return null;
    }
  }
  async save(next: Cache) {
    validateCursor(next.cursor, this.uid, next.epoch, next.seq);
    toLegacy(next.rows);
    const payload = JSON.stringify(next);
    // One durable envelope: no separately committed cursor or partial snapshot.
    await this.storage.setItem(
      this.storageKey,
      JSON.stringify({payload, checksum: sha256(payload)}),
    );
    this.cache = next;
  }
  async snapshot(epoch: string) {
    const s = await this.request('/snapshots', {epoch});
    if (
      s.epoch !== epoch ||
      !Number.isInteger(s.pageCount) ||
      s.pageCount < 1 ||
      s.pageCount > 1024
    )
      throw new Error('INVALID_SNAPSHOT');
    const rows: State = Object.create(null);
    let size = 0;
    for (let i = 0; i < s.pageCount; i++) {
      const p = await this.request(
        '/snapshots/' +
          encodeURIComponent(s.snapshotId) +
          '/pages/' +
          i +
          '?epoch=' +
          encodeURIComponent(epoch),
      );
      if (typeof p.payload !== 'string' || sha256(p.payload) !== p.checksum)
        throw new Error('SNAPSHOT_CHECKSUM');
      size += p.payload.length;
      if (size > 128 * 1024 * 1024) throw new Error('SNAPSHOT_TOO_LARGE');
      const changes = JSON.parse(p.payload).changes;
      for (const c of changes) {
        if (compareDecimal(c.version, s.seq) > 0) throw new Error('SNAPSHOT_VERSION');
      }
      apply(rows, changes, true);
    }
    if (s.expiresAt <= Date.now()) throw new Error('SNAPSHOT_EXPIRED');
    await this.save({
      schema: 1,
      protocol: 2,
      uid: this.uid,
      epoch,
      seq: s.seq,
      cursor: s.cursor,
      rows,
    });
  }
  async sync(epoch: string) {
    if (!this.cache || this.cache.epoch !== epoch) await this.snapshot(epoch);
    let until = '';
    for (let i = 0; i < 10000; i++) {
      const current = this.cache!;
      let page;
      try {
        page = await this.request(
          '/changes?epoch=' +
            encodeURIComponent(epoch) +
            '&after=' +
            encodeURIComponent(current.cursor) +
            (until ? '&until=' + encodeURIComponent(until) : ''),
        );
      } catch (e: any) {
        if (
          ['RESET_REQUIRED', 'INVALID_CURSOR', 'LOG_GAP'].includes(e.message)
        ) {
          await this.snapshot(epoch);
        }
        throw e;
      }
      if (page.epoch !== epoch || !Array.isArray(page.entries))
        throw new Error('INVALID_PAGE');
      const rows = {...current.rows};
      let seq = current.seq;
      for (const entry of page.entries) {
        if (entry.seq !== increment(seq)) throw new Error('LOG_GAP');
        for (const c of entry.payload.changes) {
          if (c.version !== entry.seq) throw new Error('DELTA_VERSION_MISMATCH');
        }
        apply(rows, entry.payload.changes);
        seq = entry.seq;
      }
      if (page.hasMore && page.entries.length === 0) throw new Error('LOG_GAP');
      if (until && page.until !== until) throw new Error('HIGHWATER_CHANGED');
      if (!page.hasMore && seq !== page.highWatermark)
        throw new Error('LOG_GAP');
      await this.save({...current, rows, seq, cursor: page.nextCursor});
      if (!page.hasMore) return this.cache;
      until = page.until;
    }
    throw new Error('PULL_LIMIT');
  }
}
