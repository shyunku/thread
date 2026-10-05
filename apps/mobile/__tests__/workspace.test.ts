// End-to-end on the mobile stack (encrypted store, vault session, workspace, sync)
// against an in-memory server: a new account on one phone, a second phone joining
// through the relay, and both editing the same task.
import { installE2eePlatform } from '@/core/e2ee/platform';
import { LocalVault } from '@/core/vault/localVault';
import { VaultSession } from '@/core/vault/session';
import {
  MobileWorkspace,
  VaultActivity,
  vaultIdFor,
} from '@/core/workspace/workspace';
import { SyncService } from '@/core/sync/syncService';
import { createTestDatabases } from '../jest/testDatabases';
import { fakeKeychain } from '../jest/fakeKeychain';
import { createFakeThreadServer } from '../jest/fakeThreadServer';

beforeAll(async () => {
  await installE2eePlatform().sodium.ready;
});

const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach(cleanup => cleanup()),
);

installE2eePlatform();
const scope = {
  environment: 'development' as const,
  accountId: 'u1',
  vaultId: vaultIdFor('development', 'u1'),
};

async function device(server: ReturnType<typeof createFakeThreadServer>) {
  const dbs = createTestDatabases();
  cleanups.push(dbs.cleanup);
  const keys = fakeKeychain();
  const vault = new LocalVault(scope, {
    openDatabase: dbs.openDatabase,
    keychain: keys.keychain,
    bootId: () => 'count:1',
  });
  const session = new VaultSession(vault);
  await session.create();
  cleanups.push(() => {
    session.lock().catch(() => {});
  });
  const activity = new VaultActivity();
  const transport = () => server.transport;
  const workspace = new MobileWorkspace({
    session,
    transport,
    reauthenticate: async () => true,
    activity,
    onKeysChanged: () => sync.reset(),
  });
  const sync = new SyncService({ session, transport, activity });
  cleanups.push(() => sync.close());
  return { session, workspace, sync, keys };
}

const task = (fields: Record<string, unknown>) => ({
  entityType: 'task',
  entityId: 't1',
  operation: 'patch',
  fields,
});
const visibleFields = (d: Awaited<ReturnType<typeof device>>) =>
  d.session.use(store => store.get('visible', 'task-1')).fields[0].value.fields;

test('vault id matches the desktop formula', () => {
  // sha256(JSON.stringify([environment, uid, "vault-v1"])) as in the desktop workspace.
  const { createHash } = require('node:crypto');
  expect(vaultIdFor('production', 'abc')).toBe(
    createHash('sha256')
      .update(JSON.stringify(['production', 'abc', 'vault-v1']))
      .digest('hex'),
  );
});

test('new account on a phone, a second phone joins by the 6-digit relay, edits merge', async () => {
  const server = createFakeThreadServer(scope.vaultId);
  const a = await device(server);

  // First device: recovery material must be confirmed before registering.
  await a.workspace.prepareIdentity();
  await expect(a.workspace.registerIdentity()).rejects.toThrow(
    'RECOVERY_CONFIRMATION_REQUIRED',
  );
  const kit = a.workspace.recoveryMaterial();
  expect(kit.code).toMatch(/^THREAD1(-[0-9A-F]{8})+$/);
  await a.workspace.confirmRecovery(kit.code, kit.bytes);
  expect((await a.workspace.registerIdentity()).phase).toBe('REGISTERED');
  expect((await a.workspace.activateEmpty()).phase).toBe('ACTIVE');
  expect(server.modes).toEqual({ accountMode: 'e2ee', vaultMode: 'active' });

  expect((await a.sync.syncNow()).phase).toBe('ACTIVE');
  a.sync.replica().enqueue([
    {
      objectId: 'task-1',
      baseVersion: '0',
      deleted: false,
      fields: [{ slot: 0, value: task({ title: '처음', memo: '' }) }],
    },
  ]);
  expect((await a.sync.syncNow()).pending).toBe(0);
  expect(server.accepted).toHaveLength(1);

  // Second device connects; both screens show the same code before anything is installed.
  const b = await device(server);
  expect((await b.workspace.relay('recipientPoll')).phase).toBe('WAITING');
  expect((await a.workspace.relay('ownerStart')).phase).toBe('WAITING');
  expect((await b.workspace.relay('recipientPoll')).phase).toBe('CONNECTING');
  const ownerView = await a.workspace.relay('ownerPoll');
  const deviceView = await b.workspace.relay('recipientPoll');
  expect(ownerView.phase).toBe('COMPARE');
  expect(deviceView.code).toBe(ownerView.code);
  expect((await a.workspace.relay('ownerApprove')).phase).toBe('DONE');
  await expect(b.workspace.relay('recipientConfirm')).resolves.toMatchObject({
    phase: 'APPROVAL',
  });
  expect((await b.workspace.relay('recipientPoll')).phase).toBe('PAIRED');

  // The new phone receives A's task through the snapshot.
  expect((await b.sync.syncNow()).phase).toBe('ACTIVE');
  expect(visibleFields(b)).toEqual({ title: '처음', memo: '' });

  // Both edit the same task offline: different fields survive, conflicts rebase (#94).
  b.sync.replica().enqueue([
    {
      objectId: 'task-1',
      baseVersion: '1',
      deleted: false,
      fields: [{ slot: 0, value: task({ title: '처음', memo: '폰 B 메모' }) }],
    },
  ]);
  a.sync.replica().enqueue([
    {
      objectId: 'task-1',
      baseVersion: '1',
      deleted: false,
      fields: [{ slot: 0, value: task({ title: '폰 A 제목', memo: '' }) }],
    },
  ]);
  expect((await b.sync.syncNow()).pending).toBe(0);
  const afterA = await a.sync.syncNow();
  expect(afterA).toMatchObject({ pending: 0, conflicts: 0 });
  await b.sync.syncNow();
  expect(visibleFields(a)).toEqual({ title: '폰 A 제목', memo: '폰 B 메모' });
  expect(visibleFields(b)).toEqual({ title: '폰 A 제목', memo: '폰 B 메모' });
});

// First phone of a new account with one synced task; returns its recovery kit.
async function ownerWithTask(
  server: ReturnType<typeof createFakeThreadServer>,
) {
  const a = await device(server);
  await a.workspace.prepareIdentity();
  const kit = a.workspace.recoveryMaterial();
  await a.workspace.confirmRecovery(kit.code, kit.bytes);
  await a.workspace.registerIdentity();
  await a.workspace.activateEmpty();
  await a.sync.syncNow();
  a.sync.replica().enqueue([
    {
      objectId: 'task-1',
      baseVersion: '0',
      deleted: false,
      fields: [{ slot: 0, value: task({ title: '처음', memo: '' }) }],
    },
  ]);
  await a.sync.syncNow();
  return { ...a, kit };
}

async function pair(
  owner: Awaited<ReturnType<typeof device>>,
  joining: Awaited<ReturnType<typeof device>>,
) {
  await joining.workspace.relay('recipientPoll');
  await owner.workspace.relay('ownerStart');
  await joining.workspace.relay('recipientPoll');
  await owner.workspace.relay('ownerPoll');
  await joining.workspace.relay('recipientPoll');
  await owner.workspace.relay('ownerApprove');
  await joining.workspace.relay('recipientConfirm');
  expect((await joining.workspace.relay('recipientPoll')).phase).toBe('PAIRED');
}

test('the first phone removes a paired phone: new recovery key, data re-protected', async () => {
  const server = createFakeThreadServer(scope.vaultId);
  const a = await ownerWithTask(server);
  const b = await device(server);
  await pair(a, b);
  expect((await b.sync.syncNow()).phase).toBe('ACTIVE');
  await a.sync.syncNow();
  const removed = a.sync.devices().find(d => !d.self)!.id;

  // Consent and the new recovery kit come before anything reaches the server.
  await expect(
    a.workspace.rotation('prepare', { remove: [removed] }),
  ).rejects.toThrow('ROTATION_CONSENT_REQUIRED');
  await a.workspace.rotation('prepare', { remove: [removed], confirmed: true });
  await expect(
    a.workspace.rotation('commit', { confirmed: true }),
  ).rejects.toThrow('RECOVERY_CONFIRMATION_REQUIRED');
  const kit = await a.workspace.rotation('material');
  expect(kit.code).not.toBe(a.kit.code);
  await a.workspace.rotation('confirm', { code: kit.code, bytes: kit.bytes });
  expect(
    (await a.workspace.rotation('commit', { confirmed: true })).phase,
  ).toBe('ACTIVE');

  // A reopens its sync session on the new membership and re-protects its data.
  expect((await a.sync.syncNow()).phase).toBe('ACTIVE');
  expect(a.sync.devices().map(d => d.id)).not.toContain(removed);
  const sent = server.accepted.length;
  expect(a.workspace.reencryption('start').phase).toBe('READY');
  for (let i = 0; i < 5; i++) {
    if (a.workspace.reencryption('status').phase === 'DONE') break;
    await a.sync.syncNow();
  }
  expect(a.workspace.reencryption('status')).toMatchObject({
    phase: 'DONE',
    count: 1,
  });
  const last = server.accepted[server.accepted.length - 1].record;
  expect(server.accepted.length).toBe(sent + 1);
  expect(
    require('@thread/e2ee/src/protocol').decode(Buffer.from(last, 'base64'))
      .body.keyGeneration,
  ).toBe(2);
  expect(visibleFields(a)).toEqual({ title: '처음', memo: '' });

  // The removed phone can no longer send changes under the old key.
  b.sync.replica().enqueue([
    {
      objectId: 'task-1',
      baseVersion: '1',
      deleted: false,
      fields: [{ slot: 0, value: task({ title: '해제된 폰', memo: '' }) }],
    },
  ]);
  await expect(b.sync.syncNow()).rejects.toThrow();
  expect(visibleFields(a)).toEqual({ title: '처음', memo: '' });
});

test('all devices lost: a new phone joins with the recovery code and file', async () => {
  const server = createFakeThreadServer(scope.vaultId);
  const { kit } = await ownerWithTask(server);

  const c = await device(server);
  await expect(
    c.workspace.recovery('prepare', { code: kit.code, bytes: kit.bytes }),
  ).rejects.toThrow('RECOVERY_CONSENT_REQUIRED');
  await c.workspace.recovery('prepare', {
    code: kit.code,
    bytes: kit.bytes,
    confirmed: true,
  });
  // A new kit replaces the one that was used.
  const next = await c.workspace.recovery('material');
  expect(next.code).not.toBe(kit.code);
  await c.workspace.recovery('confirm', { code: next.code, bytes: next.bytes });
  expect(
    (await c.workspace.recovery('commit', { confirmed: true })).phase,
  ).toBe('ACTIVE');

  expect((await c.sync.syncNow()).phase).toBe('ACTIVE');
  expect(visibleFields(c)).toEqual({ title: '처음', memo: '' });
  expect(c.sync.devices()).toEqual([
    expect.objectContaining({ self: true, canAuthorizeDevices: true }),
  ]);
});

test('only one vault action at a time; locking stops sync; recovery needs consent', async () => {
  const server = createFakeThreadServer(scope.vaultId);
  const a = await device(server);
  const preparing = a.workspace.prepareIdentity();
  await expect(a.sync.syncNow()).rejects.toThrow('VAULT_BUSY');
  await preparing;
  await expect(a.workspace.recovery('prepare', {})).rejects.toThrow(
    'RECOVERY_CONSENT_REQUIRED',
  );
  await a.session.lock();
  await expect(a.sync.syncNow()).rejects.toThrow('VAULT_LOCKED');
  expect(a.sync.status().phase).toBe('LOCKED');
});

test('a failed sync open waits before asking the server for another snapshot', async () => {
  const server = createFakeThreadServer(scope.vaultId);
  const a = await ownerWithTask(server);
  // A new session on the same phone (as after a restart) whose snapshot fails.
  a.sync.reset();
  const snapshot = server.transport.snapshot;
  let calls = 0;
  server.transport.snapshot = async (...args: any[]) => {
    calls++;
    if (calls === 1) throw Error('SYNC_RESPONSE_TOO_LARGE');
    return (snapshot as any)(...args);
  };
  await expect(a.sync.syncNow()).rejects.toThrow('SYNC_RESPONSE_TOO_LARGE');
  // Retries right away keep the first error and do not reach the server.
  await expect(a.sync.syncNow()).rejects.toThrow('SYNC_RESPONSE_TOO_LARGE');
  await expect(a.sync.syncNow()).rejects.toThrow('SYNC_RESPONSE_TOO_LARGE');
  expect(calls).toBe(1);
  expect(a.sync.status().error).toBe('SYNC_RESPONSE_TOO_LARGE');
});
