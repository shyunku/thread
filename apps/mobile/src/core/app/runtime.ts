import { AppState, type AppStateStatus } from 'react-native';
import { config, DEFAULT_SERVER_ENDPOINT } from '@/core/config';
import { installE2eePlatform } from '@/core/e2ee/platform';
import { createFetch } from '@/core/net/fetch';
import { createStreamFetch } from '@/core/net/streamFetch';
import { createAuthApi } from '@/core/auth/api';
import { AccountSession } from '@/core/auth/account';
import { accountStorage } from '@/core/auth/native';
import { googleIdToken } from '@/core/auth/google';
import { LocalVault } from '@/core/vault/localVault';
import { deviceVaultDeps, openDatabase } from '@/core/vault/native';
import { createPrefsStore } from '@/core/prefs';
import {
  askReminderPermission,
  scheduleReminders,
} from '@/core/reminders';
import { VaultSession } from '@/core/vault/session';
import {
  MobileWorkspace,
  VaultActivity,
  vaultIdFor,
  type Transport,
} from '@/core/workspace/workspace';
import { SyncService } from '@/core/sync/syncService';

const { createTransport } = require('@thread/e2ee/src/transport');

// The production server's vaults use the "production" scope, like a packaged desktop;
// any other server (local development) uses "development". Both devices of an account
// must agree or they cannot pair.
export const environment: 'development' | 'production' =
  config.serverEndpoint === DEFAULT_SERVER_ENDPOINT
    ? 'production'
    : 'development';

export type AccountRuntime = {
  uid: string;
  vault: LocalVault;
  session: VaultSession;
  workspace: MobileWorkspace;
  sync: SyncService;
  transport(): Transport;
  dispose(): void;
};

// Wires the device implementations together. Screens (#85, #87, #88) drive these
// objects; nothing here shows UI.
export function createRuntime() {
  installE2eePlatform();
  const endpoint = config.serverEndpoint;
  const fetch = createFetch();
  const streamFetch = createStreamFetch();
  let current: AccountRuntime | null = null;
  // A deleted account (#92, here or on another device): close it and remove its vault.
  // Other accounts' vaults on this phone stay.
  const forget = async (uid: string) => {
    if (current?.uid === uid) {
      current.dispose();
      current = null;
    }
    await new LocalVault(
      { environment, accountId: uid, vaultId: vaultIdFor(environment, uid) },
      deviceVaultDeps,
    ).destroy();
  };
  const account = new AccountSession({
    api: createAuthApi({ endpoint, fetch }),
    storage: accountStorage,
    endpoint,
    fetch,
    forget,
  });

  const transport = () =>
    createTransport({
      endpoint,
      token: account.tokens.current,
      renewToken: account.tokens.renew,
      fetch,
    });

  function forAccount(uid: string): AccountRuntime {
    if (current?.uid === uid) return current;
    current?.dispose();
    const vault = new LocalVault(
      { environment, accountId: uid, vaultId: vaultIdFor(environment, uid) },
      deviceVaultDeps,
    );
    const session = new VaultSession(vault);
    const activity = new VaultActivity();
    const reauthenticate = async () => {
      // Biometrics or the device PIN again before approving a device or recovering.
      const store = await vault.unlock();
      store.close();
      return true;
    };
    const workspace = new MobileWorkspace({
      session,
      transport,
      reauthenticate,
      activity,
      onKeysChanged: () => sync.reset(),
    });
    const sync = new SyncService({ session, transport, activity });
    const foreground = (state: AppStateStatus) => {
      if (state === 'active' && session.phase() === 'UNLOCKED') {
        sync.startForeground({
          endpoint,
          tokens: account.tokens,
          fetch: streamFetch,
        });
      } else if (state !== 'active') sync.stopForeground();
    };
    const subscription = AppState.addEventListener('change', foreground);
    const unsubscribe = session.subscribe(phase => {
      if (phase === 'UNLOCKED')
        foreground(AppState.currentState as AppStateStatus);
      else sync.close();
    });
    current = {
      uid,
      vault,
      session,
      workspace,
      sync,
      transport,
      dispose() {
        subscription.remove();
        sync.close();
        unsubscribe();
        session.lock().catch(() => {});
      },
    };
    return current;
  }

  return {
    account,
    forAccount,
    prefs: createPrefsStore(openDatabase),
    // Due reminders (#91) on this phone.
    reminders: { schedule: scheduleReminders, askPermission: askReminderPermission },
    // Returns the user, or { linkToken, idToken } for the link/sign-up step.
    async signInWithGoogle() {
      const idToken = await googleIdToken();
      const result = await account.signInWithGoogle(idToken);
      return 'linkToken' in result ? { ...result, idToken } : result;
    },
    async signOut() {
      current?.dispose();
      current = null;
      await account.signOut();
    },
    // Deletes the account (#92) after the screen confirmed the user; the account
    // listener then reports the sign-out with the reason "deleted".
    deleteAccount() {
      return account.deleteAccount();
    },
  };
}
