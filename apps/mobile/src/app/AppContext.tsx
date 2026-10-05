import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import type { AccountUser } from '@/core/auth/api';
import type { AccountRuntime } from '@/core/app/runtime';
import {
  adapterFor,
  markReady,
  setupState,
  type SetupState,
} from '@/core/app/setup';
import {
  buildModel,
  type Lists,
  type Model,
  type Scope,
} from '@/core/model/view';
import { defaultPrefs, type Prefs } from '@/core/prefs';
import type { SyncStatus } from '@/core/sync/syncService';
import type { VaultPhase } from '@/core/vault/session';

// What the screens need from the runtime (createRuntime in production, fakes in tests).
export type AppRuntime = {
  account: {
    restore(): Promise<AccountUser | null>;
    onChange(listener: ((user: AccountUser | null) => void) | null): void;
    signIn(authId: string, password: string): Promise<AccountUser>;
    signUp(username: string, authId: string, password: string): Promise<void>;
    linkGoogle(input: {
      idToken: string;
      linkToken: string;
      authId: string;
      password: string;
      username?: string;
    }): Promise<AccountUser>;
    revokeOtherSessions(): Promise<unknown>;
  };
  forAccount(uid: string): AccountRuntime;
  signInWithGoogle(): Promise<
    AccountUser | { linkToken: string; idToken: string }
  >;
  signOut(): Promise<void>;
  prefs: { load(): Prefs; save(prefs: Prefs): void };
};

type AppValue = {
  runtime: AppRuntime;
  ready: boolean;
  user: AccountUser | null;
  account: AccountRuntime | null;
  phase: VaultPhase | null;
  setup: SetupState | null;
  sync: SyncStatus | null;
  model: Model | null;
  prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
  refresh(): void;
  mutate(topic: string, args: unknown[]): string | null;
  setupDone(): void;
  reloadSetup(): void;
  // Which list the task and calendar tabs show (모든 할 일 · 오늘 · a category).
  // A secret category asks for biometrics/PIN first; false when not confirmed.
  scope: Scope;
  setScope(scope: Scope): Promise<boolean>;
  isSecretOpen(cid: string): boolean;
};

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({
  runtime,
  children,
}: {
  runtime: AppRuntime;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [phase, setPhase] = useState<VaultPhase | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [, setVersion] = useState(0);
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [prefs, setPrefsState] = useState<Prefs>(() => {
    try {
      return runtime.prefs.load();
    } catch {
      return { ...defaultPrefs };
    }
  });
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  // Secret categories opened with biometrics/PIN in this app session (#88).
  const [openSecrets, setOpenSecrets] = useState<string[]>([]);

  useEffect(() => {
    runtime.account.onChange(setUser);
    runtime.account
      .restore()
      .catch(() => null)
      .finally(() => setReady(true));
    return () => runtime.account.onChange(null);
  }, [runtime]);

  const account = useMemo(
    () => (user ? runtime.forAccount(user.uid) : null),
    [runtime, user],
  );

  // Vault lock state, setup progress and sync status of the signed-in account.
  const lastSync = useRef<number | null>(null);
  useEffect(() => {
    if (!account) {
      setPhase(null);
      setSetup(null);
      setSync(null);
      return;
    }
    const readSetup = (current: VaultPhase) => {
      setPhase(current);
      setSetup(
        current === 'UNLOCKED'
          ? account.session.use(store => setupState(store))
          : null,
      );
      refresh();
    };
    const offSession = account.session.subscribe(next => {
      readSetup(next);
      if (next === 'UNLOCKED') account.sync.requestSync();
    });
    const offSync = account.sync.subscribe(status => {
      setSync(status);
      // New data after each successful sync.
      if (status.lastSyncedAt !== lastSync.current) {
        lastSync.current = status.lastSyncedAt;
        refresh();
      }
    });
    readSetup(account.session.phase());
    account.session
      .start()
      .catch(() => false)
      .then(() => readSetup(account.session.phase()));
    return () => {
      offSession();
      offSync();
    };
  }, [account, refresh]);

  // The model is rebuilt only when the visible records changed (or the first sync
  // installed the vault): reading every record is the expensive part (#98).
  // `version` re-renders after syncs and edits so this key is read again.
  let modelKey = 'none';
  if (account && phase === 'UNLOCKED') {
    try {
      modelKey = account.session.use(
        store =>
          `${store.revision('visible')}:${!!store.get(
            'confirmed',
            '$sync-state',
          )}`,
      );
    } catch {}
  }
  const model = useMemo(() => {
    if (!account || phase !== 'UNLOCKED' || modelKey === 'none') return null;
    try {
      return account.session.use(store => {
        const adapter = adapterFor(store);
        return adapter ? buildModel(adapter.lists() as Lists) : null;
      });
    } catch {
      return null;
    }
  }, [account, phase, modelKey]);

  // Secret categories lock again when the app leaves the foreground or the vault locks;
  // a secret view that is no longer open falls back to all tasks.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') setOpenSecrets([]);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (phase !== 'UNLOCKED') setOpenSecrets([]);
  }, [phase]);
  const scopeSecret =
    scope.kind === 'category' && !!model?.categoryMap.get(scope.cid)?.secret;
  useEffect(() => {
    if (
      scopeSecret &&
      scope.kind === 'category' &&
      !openSecrets.includes(scope.cid)
    )
      setScope({ kind: 'all' });
  }, [scopeSecret, scope, openSecrets]);

  // Stable between renders: screens keep long-running work (pairing) keyed on these.
  const reloadSetup = useCallback(() => {
    if (!account || account.session.phase() !== 'UNLOCKED') return;
    setSetup(account.session.use(store => setupState(store)));
  }, [account]);
  const setupDone = useCallback(() => {
    if (!account) return;
    account.session.use(store => markReady(store));
    setSetup('READY');
    account.sync.requestSync();
    refresh();
  }, [account, refresh]);

  const value: AppValue = {
    runtime,
    ready,
    user,
    account,
    phase,
    setup,
    sync,
    model,
    prefs,
    setPrefs(patch) {
      setPrefsState(current => {
        const next = { ...current, ...patch };
        try {
          runtime.prefs.save(next);
        } catch {}
        return next;
      });
    },
    refresh,
    scope,
    async setScope(next) {
      const leaving =
        scope.kind === 'category' && scopeSecret ? scope.cid : null;
      const secret =
        next.kind === 'category' && !!model?.categoryMap.get(next.cid)?.secret;
      if (
        secret &&
        next.kind === 'category' &&
        !openSecrets.includes(next.cid)
      ) {
        const confirmed = await account?.workspace
          .confirmUser()
          .catch(() => false);
        if (!confirmed) return false;
      }
      setOpenSecrets(current => {
        let list = current;
        if (
          prefs.secretRelock === 'each' &&
          leaving &&
          leaving !== (next.kind === 'category' ? next.cid : null)
        )
          list = list.filter(cid => cid !== leaving);
        if (secret && next.kind === 'category' && !list.includes(next.cid))
          list = [...list, next.cid];
        return list;
      });
      setScope(next);
      return true;
    },
    isSecretOpen: cid => openSecrets.includes(cid),
    // Local edits go to the encrypted outbox right away and sync in the background.
    mutate(topic, args) {
      if (!account) throw Error('AUTH_REQUIRED');
      const id = account.session.use(store => {
        const adapter = adapterFor(store);
        if (!adapter) throw Error('SYNC_REQUIRED');
        return adapter.mutate(topic, args);
      });
      refresh();
      account.sync.requestSync();
      return id;
    },
    reloadSetup,
    setupDone,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw Error('APP_CONTEXT_MISSING');
  return value;
}
