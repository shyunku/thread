import { Buffer } from 'buffer';
import { installE2eePlatform } from '@/core/e2ee/platform';
import { EncryptedStore } from '@/core/vault/store';
import { LocalVault, VaultKeychain } from '@/core/vault/localVault';
import { protect, unprotect } from '@/core/vault/password';
import { createTestDatabases } from '../jest/testDatabases';

const fixtures = require('@thread/e2ee/test/fixtures.json');

// libsodium-wrappers (the Jest stand-in) fills in its functions after `ready`.
beforeAll(async () => {
  await installE2eePlatform().sodium.ready;
});

const scope = {
  environment: 'development' as const,
  accountId: 'synthetic',
  vaultId: 'vault-1',
};

function fakeKeychain() {
  const entries = new Map<string, { user: string; secret: string }>();
  const state = { authAllowed: true, authReads: 0 };
  const keychain: VaultKeychain = {
    async setAuthKey(service, keyHex) {
      entries.set(service, { user: 'thread', secret: keyHex });
    },
    async getAuthKey(service) {
      state.authReads++;
      return state.authAllowed ? entries.get(service)?.secret ?? null : null;
    },
    async setSessionKey(service, bootId, keyHex) {
      entries.set(service, { user: bootId, secret: keyHex });
    },
    async getSessionKey(service) {
      const entry = entries.get(service);
      return entry ? { bootId: entry.user, keyHex: entry.secret } : null;
    },
    async remove(service) {
      entries.delete(service);
    },
  };
  return { keychain, entries, state };
}

function setup() {
  const dbs = createTestDatabases();
  const keys = fakeKeychain();
  const boot = { id: 'count:7' };
  const deps = {
    openDatabase: dbs.openDatabase,
    keychain: keys.keychain,
    bootId: () => boot.id,
  };
  return { dbs, keys, boot, vault: new LocalVault(scope, deps), deps };
}

let current: ReturnType<typeof setup> | null = null;
afterEach(() => current?.dbs.cleanup());

test('store keeps the desktop record API: buckets, pages, nested transactions', () => {
  current = setup();
  const db = current.dbs.openDatabase({
    name: 'store.db',
    key: Buffer.alloc(32, 1),
  });
  const store = new EncryptedStore({ db, scope, create: true });
  store.put('confirmed', 'a', { title: '첫째', bytes: Buffer.from([1, 2]) });
  store.put('confirmed', 'b', { title: '둘째' });
  expect(store.get('confirmed', 'a')).toEqual({
    title: '첫째',
    bytes: Buffer.from([1, 2]),
  });
  expect(store.entries('confirmed', 'a', 10).map(row => row.id)).toEqual(['b']);
  expect(() => store.put('nope', 'x', 1)).toThrow('INVALID_BUCKET');
  store.transaction(outer => {
    outer.put('outbox', 'kept', 1);
    expect(() =>
      outer.transaction(inner => {
        inner.put('outbox', 'dropped', 2);
        throw Error('INNER');
      }),
    ).toThrow('INNER');
  });
  expect(store.get('outbox', 'kept')).toBe(1);
  expect(store.get('outbox', 'dropped')).toBeNull();
  expect(() => store.transaction(() => Promise.resolve())).toThrow(
    'ASYNC_TRANSACTION_FORBIDDEN',
  );
  expect(store.scope()).toEqual(scope);
  store.close();
  expect(() => store.get('confirmed', 'a')).toThrow('VAULT_LOCKED');
  // Another vault's scope or a wrong key never opens the file.
  const other = current.dbs.openDatabase({
    name: 'store.db',
    key: Buffer.alloc(32, 1),
  });
  expect(
    () =>
      new EncryptedStore({ db: other, scope: { ...scope, vaultId: 'other' } }),
  ).toThrow('STORE_SCOPE_MISMATCH');
  const wrong = current.dbs.openDatabase({
    name: 'store.db',
    key: Buffer.alloc(32, 2),
  });
  expect(() => new EncryptedStore({ db: wrong, scope })).toThrow();
});

test('vault opens without a prompt in the same boot and asks again after a reboot', async () => {
  current = setup();
  const { vault, keys, boot } = current;
  expect(vault.inspect()).toEqual({
    phase: 'ABSENT',
    passwordAvailable: false,
  });
  const created = await vault.create();
  created.put('confirmed', 'x', 1);
  created.close();
  expect(vault.inspect().phase).toBe('LOCKED');

  const resumed = await vault.resume();
  expect(resumed?.get('confirmed', 'x')).toBe(1);
  resumed?.close();
  expect(keys.state.authReads).toBe(0);

  boot.id = 'count:8';
  expect(await vault.resume()).toBeNull();
  const unlocked = await vault.unlock();
  expect(keys.state.authReads).toBe(1);
  unlocked.close();
  const again = await vault.resume();
  expect(again).not.toBeNull();
  again?.close();
  await expect(vault.create()).rejects.toThrow('VAULT_EXISTS');
});

test('manual lock forgets the session; cancelled authentication keeps the vault closed', async () => {
  current = setup();
  const { vault, keys } = current;
  (await vault.create()).close();
  await vault.forgetSession();
  expect(await vault.resume()).toBeNull();
  keys.state.authAllowed = false;
  await expect(vault.unlock()).rejects.toThrow('AUTH_FAILED_OR_CANCELLED');
  expect(await vault.resume()).toBeNull();
});

test('optional password opens the vault and wrong passwords do not', async () => {
  current = setup();
  const { vault } = current;
  (await vault.create({ password: '올바른 비밀번호 1234' })).close();
  await vault.forgetSession();
  expect(vault.inspect().passwordAvailable).toBe(true);
  await expect(vault.unlockWithPassword('틀린 비밀번호 1234')).rejects.toThrow(
    'INVALID_PASSWORD_OR_DAMAGED_KEY',
  );
  const store = await vault.unlockWithPassword('올바른 비밀번호 1234');
  expect(store.scope()).toEqual(scope);
  store.close();
  expect(await vault.resume()).not.toBeNull();
});

test('an unfinished vault is reported for recovery, never reset', async () => {
  current = setup();
  const { vault, deps } = current;
  const index = deps.openDatabase({ name: 'thread-vaults.db' });
  index.executeSync(
    'CREATE TABLE IF NOT EXISTS vaults(id TEXT PRIMARY KEY,ready INTEGER NOT NULL,password BLOB)',
  );
  index.executeSync('INSERT INTO vaults(id,ready,password) VALUES(?,0,NULL)', [
    vault.id,
  ]);
  index.close();
  expect(vault.inspect().phase).toBe('RECOVERY_REQUIRED');
  await expect(vault.create()).rejects.toThrow('VAULT_EXISTS');
  await expect(vault.unlock()).rejects.toThrow('VAULT_RECOVERY_REQUIRED');
});

test('password envelopes match the desktop format both ways', async () => {
  const f = fixtures.localPassword;
  const key = await unprotect(
    Buffer.from(f.envelopeHex, 'hex'),
    f.password,
    f.context,
  );
  expect(key.toString('hex')).toBe(f.keyHex);
  const mine = await protect(
    Buffer.from(f.keyHex, 'hex'),
    f.password,
    f.context,
  );
  expect((await unprotect(mine, f.password, f.context)).toString('hex')).toBe(
    f.keyHex,
  );
  await expect(protect(Buffer.alloc(32), '짧음', f.context)).rejects.toThrow(
    'INVALID_VAULT_PASSWORD',
  );
});

test('session: silent start in the same boot, manual lock, lock wins over a pending unlock', async () => {
  const { VaultSession } = require('@/core/vault/session');
  current = setup();
  const { vault, boot } = current;
  const session = new VaultSession(vault);
  const phases: string[] = [];
  session.onChange((phase: string) => phases.push(phase));
  expect(session.phase()).toBe('ABSENT');
  await session.create();
  expect(session.phase()).toBe('UNLOCKED');
  session.use((store: EncryptedStore) => store.put('recovery', 'n', 1));

  const restarted = new VaultSession(vault);
  expect(await restarted.start()).toBe(true);
  expect(
    restarted.use((store: EncryptedStore) => store.get('recovery', 'n')),
  ).toBe(1);
  await restarted.lock();
  expect(restarted.phase()).toBe('LOCKED');
  expect(() => restarted.use(() => 1)).toThrow('VAULT_LOCKED');
  session.use(() => 1); // The other in-memory session is not affected.
  await session.lock();

  boot.id = 'count:9';
  const afterReboot = new VaultSession(vault);
  expect(await afterReboot.start()).toBe(false);
  const pending = afterReboot.unlock();
  await afterReboot.lock();
  await expect(pending).rejects.toThrow('UNLOCK_CANCELLED');
  expect(afterReboot.phase()).toBe('LOCKED');
  expect(phases).toContain('UNLOCKED');
});
