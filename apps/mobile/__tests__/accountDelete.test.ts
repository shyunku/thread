import { createHash } from 'node:crypto';
import { installE2eePlatform } from '@/core/e2ee/platform';
import { createAuthApi, encryptedPassword } from '@/core/auth/api';
import { AccountSession, AccountStorage } from '@/core/auth/account';
import { createFetch } from '@/core/net/fetch';
import { LocalVault } from '@/core/vault/localVault';
import { createTestDatabases } from '../jest/testDatabases';
import { fakeKeychain } from '../jest/fakeKeychain';

// Account deletion (#92) against a synthetic server; no real account or network.
beforeAll(async () => {
  await installE2eePlatform().sodium.ready;
});

const ENDPOINT = 'https://api.example.test';
const hex = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

function fakeServer() {
  const calls: { path: string; headers: any; body: any }[] = [];
  const state = {
    deletes: [204] as number[],
    refresh: { status: 200, code: null as string | null },
    refreshes: 0,
  };
  const reply = (status: number, json?: unknown) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: {},
    arrayBuffer: async () =>
      new TextEncoder().encode(json === undefined ? '' : JSON.stringify(json))
        .buffer,
  });
  const base = async (url: string, init: any) => {
    const path = new URL(url).pathname;
    const body =
      typeof init.body === 'string' && init.body ? JSON.parse(init.body) : null;
    calls.push({ path, headers: init.headers, body });
    if (path === '/v1/auth/login')
      return body.encrypted_password ===
        hex(encryptedPassword('jo', 'secret pw'))
        ? reply(200, {
            user: { uid: 'u1', username: 'Jo', auth_id: 'jo' },
            auth: {
              access_token: { token: 'access-0' },
              refresh_token: { token: 'refresh-0' },
            },
          })
        : reply(401);
    if (path === '/v1/auth/refreshToken') {
      state.refreshes++;
      if (state.refresh.status !== 200)
        return reply(
          state.refresh.status,
          state.refresh.code ? { code: state.refresh.code } : undefined,
        );
      return reply(200, {
        access_token: { token: 'access-' + state.refreshes },
        refresh_token: { token: 'refresh-' + state.refreshes },
      });
    }
    if (path === '/v1/auth/account/delete') {
      const status = state.deletes.shift() ?? 204;
      return reply(
        status,
        status === 204 ? undefined : { code: 'ACCOUNT_DELETE_UNAVAILABLE' },
      );
    }
    return reply(404);
  };
  return { fetch: createFetch(base as any), calls, state };
}

function memoryStorage(): AccountStorage & { value: any } {
  return {
    value: null,
    async load() {
      return this.value;
    },
    async save(value) {
      this.value = JSON.parse(JSON.stringify(value));
    },
    async clear() {
      this.value = null;
    },
  };
}

async function setup() {
  const server = fakeServer();
  const storage = memoryStorage();
  const forgotten: string[] = [];
  const changes: unknown[][] = [];
  const account = new AccountSession({
    api: createAuthApi({ endpoint: ENDPOINT, fetch: server.fetch }),
    storage,
    endpoint: ENDPOINT,
    fetch: server.fetch,
    forget: uid => {
      forgotten.push(uid);
    },
    retryDelay: 0,
  });
  account.onChange((user, reason) => changes.push([user, reason]));
  await account.signIn('jo', 'secret pw');
  return { server, storage, account, forgotten, changes };
}

test('deleting posts {} with the access token, then forgets the vault and signs out as "deleted"', async () => {
  const { server, storage, account, forgotten, changes } = await setup();
  await account.deleteAccount();
  const call = server.calls.find(c => c.path === '/v1/auth/account/delete');
  expect(call?.headers.Authorization).toBe('Bearer access-0');
  expect(call?.body).toEqual({});
  expect(forgotten).toEqual(['u1']);
  expect(changes.at(-1)).toEqual([null, 'deleted']);
  expect(storage.value).toBeNull();
  expect(account.user()).toBeNull();
});

test('503 is retried once; a refusal keeps the account', async () => {
  const retry = await setup();
  retry.server.state.deletes = [503, 204];
  await retry.account.deleteAccount();
  expect(
    retry.server.calls.filter(c => c.path === '/v1/auth/account/delete'),
  ).toHaveLength(2);
  expect(retry.forgotten).toEqual(['u1']);

  const down = await setup();
  down.server.state.deletes = [503, 503];
  await expect(down.account.deleteAccount()).rejects.toMatchObject({
    code: 'ACCOUNT_DELETE_UNAVAILABLE',
  });
  const admin = await setup();
  admin.server.state.deletes = [403];
  await expect(admin.account.deleteAccount()).rejects.toMatchObject({
    code: 'ACCOUNT_DELETE_FORBIDDEN',
  });
  for (const value of [down, admin]) {
    expect(value.forgotten).toEqual([]);
    expect(value.account.user()?.uid).toBe('u1');
    expect(value.storage.value).not.toBeNull();
  }
});

test('a lost answer: the retry sees the session gone and ACCOUNT_DELETED, which is success', async () => {
  const { server, account, forgotten, changes } = await setup();
  server.state.deletes = [401];
  server.state.refresh = { status: 401, code: 'ACCOUNT_DELETED' };
  await account.deleteAccount();
  expect(forgotten).toEqual(['u1']);
  expect(changes.at(-1)).toEqual([null, 'deleted']);
});

test('deleted on another device: the next refresh forgets the vault and signs out as "deletedElsewhere"', async () => {
  const { server, storage, account, forgotten, changes } = await setup();
  server.state.refresh = { status: 401, code: 'ACCOUNT_DELETED' };
  await expect(account.tokens.renew('access-0')).rejects.toMatchObject({
    code: 'ACCOUNT_DELETED',
  });
  expect(forgotten).toEqual(['u1']);
  expect(changes.at(-1)).toEqual([null, 'deletedElsewhere']);
  expect(storage.value).toBeNull();
  // Other refusals stay a plain sign-out without touching the vault.
  const other = await setup();
  other.server.state.refresh = { status: 401, code: 'REFRESH_REUSED' };
  await expect(other.account.tokens.renew('access-0')).rejects.toMatchObject({
    code: 'AUTH_REQUIRED',
  });
  expect(other.forgotten).toEqual([]);
  expect(other.changes.at(-1)).toEqual([null, undefined]);
});

test('destroying a vault removes its keys, database and index row; other vaults stay', async () => {
  const dbs = createTestDatabases();
  const keys = fakeKeychain();
  try {
    const deps = {
      openDatabase: dbs.openDatabase,
      keychain: keys.keychain,
      bootId: () => 'count:1',
      removeDatabase: dbs.removeDatabase,
    };
    const scope = (accountId: string) => ({
      environment: 'development' as const,
      accountId,
      vaultId: 'vault-' + accountId,
    });
    const gone = new LocalVault(scope('u1'), deps);
    const kept = new LocalVault(scope('u2'), deps);
    (await gone.create()).close();
    (await kept.create()).close();
    expect(dbs.exists(`vault-${gone.id}.db`)).toBe(true);
    await gone.destroy();
    expect(gone.inspect().phase).toBe('ABSENT');
    expect(dbs.exists(`vault-${gone.id}.db`)).toBe(false);
    expect([...keys.entries.keys()].some(k => k.includes(gone.id))).toBe(false);
    expect(kept.inspect().phase).toBe('LOCKED');
    expect([...keys.entries.keys()].some(k => k.includes(kept.id))).toBe(true);
    (await kept.unlock()).close();
  } finally {
    dbs.cleanup();
  }
});
