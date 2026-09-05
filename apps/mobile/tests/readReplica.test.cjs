const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../node_modules/typescript');
const sha256 = require('../node_modules/sha256');
const file = path.resolve(__dirname, '../src/sync/readReplica.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics.length, 0);
const mod = new Module(file, module);
mod.filename = file;
mod.paths = Module._nodeModulePaths(path.dirname(file));
mod._compile(compiled.outputText, file);
const {ReadReplica, toLegacy, compareDecimal} = mod.exports;
const cursor = (seq, uid = 'u', epoch = 'e') =>
  Buffer.from(JSON.stringify({UID: uid, Epoch: epoch, Seq: seq})).toString(
    'base64url',
  ) + '.fixture';
const task = (id, rank = '4294967296') => ({
  entityType: 'task',
  entityId: id,
  operation: 'create',
  version: '1',
  fields: {title: id, sort_rank: rank, created_at: 1, done: false},
});
function fixture(changes = [task('one')]) {
  const values = new Map();
  let failWrite = false;
  const storage = {
    getItem: async k => values.get(k) || null,
    setItem: async (k, v) => {
      if (failWrite) throw Error('DISK_FULL');
      values.set(k, v);
    },
  };
  const pages = [{changes}];
  const request = async route => {
    if (route === '/snapshots')
      return {
        snapshotId: 's',
        epoch: 'e',
        seq: '1',
        cursor: cursor('1'),
        pageCount: pages.length,
        expiresAt: Date.now() + 100000,
      };
    if (route.startsWith('/snapshots/s/pages/')) {
      const payload = JSON.stringify(
        pages[Number(route.split('/pages/')[1].split('?')[0])],
      );
      return {payload, checksum: sha256(payload)};
    }
    throw Error('unexpected request ' + route);
  };
  return {
    values,
    storage,
    pages,
    request,
    fail: () => {
      failWrite = true;
    },
  };
}
test('snapshot preserves fields, exact IDs, relations and huge rank ordering', async () => {
  const f = fixture([
    task('__proto__', '9007199254740994'),
    task('first', '-9007199254740994'),
    {
      entityType: 'category',
      entityId: 'cat',
      operation: 'create',
      version: '1',
      fields: {
        title: 'C',
        secret: true,
        locked: true,
        color: '#abc',
        created_at: 1,
      },
    },
    {
      entityType: 'taskCategory',
      entityId: 'cat',
      parentId: 'first',
      operation: 'patch',
      version: '1',
      fields: {present: true},
    },
    {
      entityType: 'subtask',
      entityId: 's',
      parentId: 'first',
      operation: 'create',
      version: '1',
      fields: {
        title: 'S',
        done: true,
        done_at: 10,
        due_date: 20,
        created_at: 1,
      },
    },
  ]);
  const r = new ReadReplica('u', f.storage, f.request);
  await r.snapshot('e');
  const state = toLegacy(r.cache.rows);
  assert.equal(state.tasks.first.next, '__proto__');
  assert.equal(state.categories.cat.locked, true);
  assert.equal(state.tasks.first.subtasks.s.doneAt, 10);
  assert.equal(state.tasks.first.categories.cat.color, '#abc');
  assert.equal(compareDecimal('9007199254740993', '9007199254740994'), -1);
  const reopened = new ReadReplica('u', f.storage, f.request);
  await reopened.load();
  assert.equal(reopened.cache.seq, '1');
  const another = new ReadReplica('another', f.storage, f.request);
  assert.equal(await another.load(), null);
});
test('delta delete and cursor commit together; disk failure retains confirmed prefix', async () => {
  const f = fixture();
  const r = new ReadReplica('u', f.storage, f.request);
  await r.snapshot('e');
  const request = async () => ({
    epoch: 'e',
    entries: [
      {
        seq: '2',
        payload: {
          changes: [
            {
              entityType: 'task',
              entityId: 'one',
              operation: 'delete',
              version: '2',
              fields: {deleted_at: 100},
            },
          ],
        },
      },
    ],
    nextCursor: cursor('2'),
    until: cursor('2'),
    highWatermark: '2',
    hasMore: false,
  });
  r.request = request;
  await r.sync('e');
  assert.equal(Object.keys(toLegacy(r.cache.rows).tasks).length, 0);
  assert.equal(r.cache.seq, '2');
  const original = f.values.get(r.storageKey);
  f.fail();
  await assert.rejects(r.snapshot('e'));
  assert.equal(f.values.get(r.storageKey), original);
  assert.equal(r.cache.seq, '2');
});
test('gap, mismatched cursor and broken snapshot checksum do not clear cache', async () => {
  const f = fixture();
  const r = new ReadReplica('u', f.storage, f.request);
  await r.snapshot('e');
  const before = f.values.get(r.storageKey);
  r.request = async () => ({
    epoch: 'e',
    entries: [{seq: '3', payload: {changes: []}}],
    nextCursor: cursor('3'),
    hasMore: false,
    highWatermark: '3',
  });
  await assert.rejects(r.sync('e'), /LOG_GAP/);
  assert.equal(f.values.get(r.storageKey), before);
  r.request = async () => ({
    epoch: 'e',
    entries: [],
    nextCursor: cursor('5'),
    hasMore: false,
    highWatermark: '1',
  });
  await assert.rejects(r.sync('e'), /CURSOR_MISMATCH/);
  r.request = async route =>
    route === '/snapshots'
      ? {
          snapshotId: 's',
          epoch: 'e',
          seq: '2',
          cursor: cursor('2'),
          pageCount: 1,
          expiresAt: Date.now() + 10000,
        }
      : {payload: '{}', checksum: 'bad'};
  await assert.rejects(r.snapshot('e'), /SNAPSHOT_CHECKSUM/);
  assert.equal(f.values.get(r.storageKey), before);
});
test('corrupt cache is preserved as recovery, cursor is not reused', async () => {
  const f = fixture();
  const r = new ReadReplica('u', f.storage, f.request);
  f.values.set(r.storageKey, 'broken');
  assert.equal(await r.load(), null);
  assert.equal(r.cache, null);
  assert.ok([...f.values.keys()].some(k => k.includes(':recovery:')));
});

test('Redux snapshot replacement removes deleted rows and changes owner atomically', () => {
  const sourceFile = path.resolve(__dirname, '../src/store/stateSlice.tsx');
  const out = ts.transpileModule(fs.readFileSync(sourceFile, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    reportDiagnostics: true,
  });
  assert.equal(out.diagnostics.length, 0);
  const module = new Module(sourceFile);
  module.filename = sourceFile;
  module.paths = Module._nodeModulePaths(path.dirname(sourceFile));
  module._compile(out.outputText, sourceFile);
  const reducer = module.exports.default;
  const replace = module.exports.replaceState;
  let state = reducer(undefined, replace({ownerUid: 'a', tasks: {old: {id: 'old'}}, categories: {c: {id: 'c'}}}));
  state = reducer(state, replace({ownerUid: 'a', tasks: {}, categories: {}}));
  assert.deepEqual(state.tasks, {});
  state = reducer(state, replace({ownerUid: 'b', tasks: {new: {id: 'new'}}, categories: {}}));
  assert.equal(state.ownerUid, 'b');
  assert.deepEqual(Object.keys(state.tasks), ['new']);
});
