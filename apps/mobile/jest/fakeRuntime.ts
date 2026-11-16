// A runtime for UI tests: the real vault, workspace and sync classes on test
// databases, a fake Keystore and the in-memory server; accounts are faked.
import type { AppRuntime } from '@/app/AppContext';
import { defaultPrefs, type Prefs } from '@/core/prefs';
import { LocalVault } from '@/core/vault/localVault';
import { VaultSession } from '@/core/vault/session';
import {
  MobileWorkspace,
  VaultActivity,
  vaultIdFor,
} from '@/core/workspace/workspace';
import { SyncService } from '@/core/sync/syncService';
import { createTestDatabases } from './testDatabases';
import { fakeKeychain } from './fakeKeychain';
import { createFakeThreadServer } from './fakeThreadServer';

export function createFakeRuntime({
  uid = 'u1',
  server = createFakeThreadServer(vaultIdFor('development', uid)),
}: {
  uid?: string;
  server?: ReturnType<typeof createFakeThreadServer>;
} = {}) {
  const dbs = createTestDatabases();
  const keys = fakeKeychain();
  let user: any = null;
  let listener: ((value: any, reason?: any) => void) | null = null;
  let prefs: Prefs = { ...defaultPrefs, theme: 'dark' };
  const accounts = new Map<string, any>();
  let deleteResult = 'ok';
  let deleteCalls = 0;
  // The phone's boot (a reboot drops the same-boot resume) and the network (#112):
  // `hold` keeps every server call waiting until release(); `offline` fails them.
  const boot = { id: 'count:1' };
  const net = { offline: false, hold: false, waiting: [] as (() => void)[] };
  const netTransport = new Proxy(server.transport as any, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (!net.hold && !net.offline) return value.apply(target, args);
        return (async () => {
          if (net.hold)
            await new Promise<void>(resolve => net.waiting.push(resolve));
          if (net.offline) throw Error('NETWORK_UNAVAILABLE');
          return value.apply(target, args);
        })();
      };
    },
  });
  // The account is gone (#92): close and destroy its vault, then report the sign-out.
  const gone = async (reason: 'deleted' | 'deletedElsewhere') => {
    const value = accounts.get(uid);
    if (value) {
      value.sync.close();
      await value.session.lock();
      await value.vault.destroy();
      accounts.delete(uid);
    }
    user = null;
    listener?.(null, reason);
  };
  const runtime: AppRuntime = {
    account: {
      // Like AccountSession.restore: a stored sign-in is reported to the listener.
      restore: async () => {
        if (user) listener?.(user);
        return user;
      },
      onChange: next => (listener = next),
      async signIn(authId: string, password: string) {
        if (password !== 'secret pw')
          throw Object.assign(Error('INVALID_CREDENTIALS'), {
            code: 'INVALID_CREDENTIALS',
          });
        user = {
          uid,
          username: 'Jo',
          authId,
          googleEmail: null,
          profileImageUrl: null,
        };
        listener?.(user);
        return user;
      },
      async signUp() {},
      async linkGoogle() {
        return user;
      },
      async revokeOtherSessions() {
        return true;
      },
    },
    forAccount(id: string) {
      if (accounts.has(id)) return accounts.get(id);
      const vault = new LocalVault(
        {
          environment: 'development',
          accountId: id,
          vaultId: vaultIdFor('development', id),
        },
        {
          openDatabase: dbs.openDatabase,
          keychain: keys.keychain,
          bootId: () => boot.id,
          removeDatabase: dbs.removeDatabase,
        },
      );
      const session = new VaultSession(vault);
      const activity = new VaultActivity();
      const transport = () => netTransport;
      const workspace = new MobileWorkspace({
        session,
        transport,
        // Biometrics/PIN prompt: succeeds unless a test turns it off.
        reauthenticate: async () => keys.state.authAllowed,
        activity,
        onKeysChanged: () => sync.reset(),
      });
      const sync = new SyncService({ session, transport, activity });
      const value = {
        uid: id,
        vault,
        session,
        workspace,
        sync,
        transport,
        dispose: () => sync.close(),
      };
      accounts.set(id, value);
      return value as any;
    },
    async signInWithGoogle() {
      throw Error('GOOGLE_NOT_CONFIGURED');
    },
    async signOut() {
      for (const value of accounts.values()) value.dispose();
      user = null;
      listener?.(null);
    },
    // Like createRuntime: the server answers (deleteResult), then this account's vault goes.
    async deleteAccount() {
      deleteCalls++;
      if (deleteResult !== 'ok')
        throw Object.assign(Error(deleteResult), { code: deleteResult });
      await gone('deleted');
    },
    prefs: { load: () => prefs, save: next => (prefs = next) },
  };
  return {
    runtime,
    server,
    keys,
    dbs,
    account: () => accounts.get(uid),
    setDeleteResult: (value: string) => (deleteResult = value),
    deleteCalls: () => deleteCalls,
    // A refresh answered ACCOUNT_DELETED (deleted on another device).
    deletedElsewhere: () => gone('deletedElsewhere'),
    net,
    // Lets the held server calls go on.
    release() {
      net.hold = false;
      for (const resolve of net.waiting.splice(0)) resolve();
    },
    // The app process ends (unmount the app first) and starts again with the same signed-in
    // account; after a reboot the same-boot resume no longer opens the vault.
    restart({ reboot = false }: { reboot?: boolean } = {}) {
      for (const value of accounts.values()) value.sync.close();
      accounts.clear();
      if (reboot) boot.id = 'count:2';
    },
    cleanup() {
      for (const value of accounts.values()) {
        value.sync.close();
        value.session.lock().catch(() => {});
      }
      dbs.cleanup();
    },
  };
}
