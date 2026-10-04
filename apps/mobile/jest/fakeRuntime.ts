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

export function createFakeRuntime({ uid = 'u1' } = {}) {
  const dbs = createTestDatabases();
  const keys = fakeKeychain();
  const server = createFakeThreadServer(vaultIdFor('development', uid));
  let user: any = null;
  let listener: ((value: any) => void) | null = null;
  let prefs: Prefs = { ...defaultPrefs, theme: 'dark' };
  const accounts = new Map<string, any>();
  const runtime: AppRuntime = {
    account: {
      restore: async () => user,
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
          bootId: () => 'count:1',
        },
      );
      const session = new VaultSession(vault);
      const activity = new VaultActivity();
      const transport = () => server.transport;
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
    prefs: { load: () => prefs, save: next => (prefs = next) },
  };
  return {
    runtime,
    server,
    keys,
    account: () => accounts.get(uid),
    cleanup() {
      for (const value of accounts.values()) {
        value.sync.close();
        value.session.lock().catch(() => {});
      }
      dbs.cleanup();
    },
  };
}
