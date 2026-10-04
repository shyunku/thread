import { createHash } from 'node:crypto';
import { installE2eePlatform } from '@/core/e2ee/platform';
import { apiURL, createAuthApi, encryptedPassword } from '@/core/auth/api';
import { AccountSession, AccountStorage } from '@/core/auth/account';
import { createFetch } from '@/core/net/fetch';

beforeAll(async () => {
  await installE2eePlatform().sodium.ready;
});

const hex = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');
const ENDPOINT = 'https://api.example.test';

// A fake API server behind a WHATWG-style fetch (RN fetch has arrayBuffer, no stream).
function fakeServer() {
  const calls: { path: string; headers: any; body: any }[] = [];
  let refreshCount = 0;
  let refreshStatus = 200;
  let revokeStatuses = [204];
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
    const auth = (n: number) => ({
      access_token: { token: 'access-' + n },
      refresh_token: { token: 'refresh-' + n },
    });
    if (path === '/v1/auth/login') {
      return body.encrypted_password ===
        hex(encryptedPassword('jo', 'secret pw'))
        ? reply(200, {
            user: { uid: 'u1', username: 'Jo', auth_id: 'jo' },
            auth: auth(0),
          })
        : reply(401);
    }
    if (path === '/v1/auth/refreshToken') {
      await new Promise(resolve => setTimeout(resolve, 5));
      refreshCount++;
      return refreshStatus === 200
        ? reply(200, auth(refreshCount))
        : reply(refreshStatus);
    }
    if (path === '/v1/auth/logout') return reply(204);
    if (path === '/v1/auth/sessions/revoke')
      return reply(revokeStatuses.shift() ?? 204);
    if (path === '/v1/google_auth/signup_mobile') {
      return reply(200, {
        user: { uid: 'u1', google_email: 'jo@example.test' },
        auth: auth(0),
      });
    }
    return reply(404);
  };
  return {
    fetch: createFetch(base as any),
    calls,
    refreshes: () => refreshCount,
    setRefreshStatus: (status: number) => (refreshStatus = status),
    setRevoke: (statuses: number[]) => (revokeStatuses = statuses),
  };
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

function setup() {
  const server = fakeServer();
  const storage = memoryStorage();
  const api = createAuthApi({ endpoint: ENDPOINT, fetch: server.fetch });
  const account = new AccountSession({
    api,
    storage,
    endpoint: ENDPOINT,
    fetch: server.fetch,
  });
  return { server, storage, account };
}

test('password hashing matches the desktop client and the server only sees the hash', async () => {
  expect(encryptedPassword('jo', 'secret pw')).toBe(
    hex(hex('jo') + 'secret pw'),
  );
  const { server, storage, account } = setup();
  await expect(account.signIn('jo', 'wrong')).rejects.toThrow(
    'INVALID_CREDENTIALS',
  );
  const user = await account.signIn('jo', 'secret pw');
  expect(user).toMatchObject({ uid: 'u1', username: 'Jo', authId: 'jo' });
  expect(JSON.stringify(server.calls)).not.toContain('secret pw');
  expect(storage.value.tokens).toEqual({
    accessToken: 'access-0',
    refreshToken: 'refresh-0',
  });
});

test('token renewal runs once for concurrent callers and follows rotation', async () => {
  const { server, storage, account } = setup();
  await account.signIn('jo', 'secret pw');
  const [a, b] = await Promise.all([
    account.tokens.renew('access-0'),
    account.tokens.renew('access-0'),
  ]);
  expect([a, b]).toEqual(['access-1', 'access-1']);
  expect(server.refreshes()).toBe(1);
  expect(await account.tokens.renew('access-0')).toBe('access-1'); // stale caller gets the new token
  expect(storage.value.tokens.refreshToken).toBe('refresh-1');
  const refresh = server.calls.find(
    call => call.path === '/v1/auth/refreshToken',
  );
  expect(refresh?.headers).toMatchObject({
    Authorization: 'Bearer access-0',
    'X-Refresh-Token': 'refresh-0',
  });
});

test('a rejected refresh (reused or revoked session) signs out locally', async () => {
  const { server, storage, account } = setup();
  const changes: unknown[] = [];
  account.onChange(user => changes.push(user));
  await account.signIn('jo', 'secret pw');
  server.setRefreshStatus(401);
  await expect(account.tokens.renew('access-0')).rejects.toThrow(
    'AUTH_REQUIRED',
  );
  expect(account.user()).toBeNull();
  expect(storage.value).toBeNull();
  expect(changes.at(-1)).toBeNull();
});

test('sign out ends the server session; revoking others renews once on 401', async () => {
  const { server, storage, account } = setup();
  await account.signIn('jo', 'secret pw');
  server.setRevoke([401, 204]);
  expect(await account.revokeOtherSessions()).toBe(true);
  expect(server.refreshes()).toBe(1);
  await account.signOut();
  const logout = server.calls.find(call => call.path === '/v1/auth/logout');
  expect(logout?.headers['X-Refresh-Token']).toBe('refresh-1');
  expect(storage.value).toBeNull();
  await expect(account.tokens.current()).rejects.toThrow('AUTH_REQUIRED');
});

test('Google sign-in exchanges the ID token for a linked account', async () => {
  const { server, account } = setup();
  const user = await account.signInWithGoogle('google-id-token');
  expect('linkToken' in user ? null : user.googleEmail).toBe('jo@example.test');
  expect(server.calls.at(-1)?.body).toEqual({
    google_access_token: 'google-id-token',
  });
});

test('endpoints: https anywhere, http only to this device', () => {
  expect(apiURL('https://api.threadapp.kr', '/v1/auth/login')).toBe(
    'https://api.threadapp.kr/v1/auth/login',
  );
  expect(apiURL('http://localhost:4033', '/x')).toBe('http://localhost:4033/x');
  expect(() => apiURL('http://10.0.2.2:4033', '/x')).toThrow(
    'INSECURE_ENDPOINT',
  );
});

test('fetch adapter serves a buffered body through the reader and sends binary bodies', async () => {
  let sent: any;
  const fetch = createFetch((async (_url: string, init: any) => {
    sent = init.body;
    return {
      status: 200,
      ok: true,
      headers: {},
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  }) as any);
  const response = await fetch('https://x.test', {
    method: 'POST',
    body: new Uint8Array([9, 8]),
  });
  expect(new Uint8Array(sent)).toEqual(new Uint8Array([9, 8]));
  const reader = response.body.getReader();
  expect([...(await reader.read()).value]).toEqual([1, 2, 3]);
  expect((await reader.read()).done).toBe(true);
});

test('an unlinked Google account asks to link with an existing id and password first', async () => {
  const calls: { path: string; body: any }[] = [];
  let linked = false;
  const reply = (status: number, json?: unknown) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: {},
    arrayBuffer: async () =>
      new TextEncoder().encode(json === undefined ? '' : JSON.stringify(json))
        .buffer,
  });
  const fetch = createFetch((async (url: string, init: any) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    calls.push({ path, body });
    if (path === '/v1/google_auth/signup_mobile') {
      return linked
        ? reply(200, {
            user: { uid: 'u1' },
            auth: {
              access_token: { token: 'a' },
              refresh_token: { token: 'r' },
            },
          })
        : reply(200, { linkToken: 'link-1' });
    }
    if (path === '/v1/google_auth/signup') {
      if (body.encrypted_password !== hex(encryptedPassword('jo', 'secret pw')))
        return reply(401);
      linked = true;
      return reply(200, {});
    }
    return reply(404);
  }) as any);
  const storage = memoryStorage();
  const account = new AccountSession({
    api: createAuthApi({ endpoint: ENDPOINT, fetch }),
    storage,
    endpoint: ENDPOINT,
    fetch,
  });
  expect(await account.signInWithGoogle('id-token')).toEqual({
    linkToken: 'link-1',
  });
  expect(storage.value).toBeNull();
  await expect(
    account.linkGoogle({
      idToken: 'id-token',
      linkToken: 'link-1',
      authId: 'jo',
      password: 'wrong',
    }),
  ).rejects.toThrow('INVALID_CREDENTIALS_OR_LINK_EXPIRED');
  const user = await account.linkGoogle({
    idToken: 'id-token',
    linkToken: 'link-1',
    authId: 'jo',
    password: 'secret pw',
  });
  expect(user.uid).toBe('u1');
  expect(
    calls.filter(call => call.path === '/v1/google_auth/signup').at(-1)?.body,
  ).toEqual({
    auth_id: 'jo',
    encrypted_password: hex(encryptedPassword('jo', 'secret pw')),
    google_link_token: 'link-1',
  });
});
