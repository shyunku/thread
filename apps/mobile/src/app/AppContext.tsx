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
  scope: Scope;
  setScope(scope: Scope): void;
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
  const [version, setVersion] = useState(0);
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [prefs, setPrefsState] = useState<Prefs>(() => {
    try {
      return runtime.prefs.load();
    } catch {
      return { ...defaultPrefs };
    }
  });
  const refresh = useCallback(() => setVersion(value => value + 1), []);

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

  const model = useMemo(() => {
    // `version` is bumped by sync and mutations to rebuild the model.
    // eslint-disable-next-line no-void
    void version;
    if (!account || phase !== 'UNLOCKED') return null;
    try {
      return account.session.use(store => {
        const adapter = adapterFor(store);
        return adapter ? buildModel(adapter.lists() as Lists) : null;
      });
    } catch {
      return null;
    }
  }, [account, phase, version]);

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
    setScope,
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
    reloadSetup() {
      if (!account || account.session.phase() !== 'UNLOCKED') return;
      setSetup(account.session.use(store => setupState(store)));
    },
    setupDone() {
      if (!account) return;
      account.session.use(store => markReady(store));
      setSetup('READY');
      account.sync.requestSync();
      refresh();
    },
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw Error('APP_CONTEXT_MISSING');
  return value;
}
