import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import {
  AppProvider,
  FIRST_SYNC_LIMIT,
  FIRST_SYNC_WAIT,
  useApp,
  type AppRuntime,
} from '@/app/AppContext';
import { defaultPrefs } from '@/core/prefs';

// The start-up wait (#112) with stand-in accounts and fake timers: the limit without stored
// data, and a resume that ends after the account changed.

function Probe() {
  const { loading, phase, user } = useApp();
  return (
    <Text testID="probe">{`${user?.uid ?? '-'} ${phase ?? '-'} ${
      loading ? 'loading' : 'open'
    }`}</Text>
  );
}
const probe = () => screen.getByTestId('probe').props.children;

// An account whose vault reopens when `resume` resolves; its sync starts and never ends.
function standIn(uid: string) {
  let open = false;
  let resolveStart: (value: boolean) => void = () => {};
  const sessionListeners = new Set<(phase: any) => void>();
  const syncListeners = new Set<(status: any) => void>();
  const status = { syncing: false, lastSyncedAt: null as number | null };
  // A connected vault without the first snapshot (no $sync-state).
  const store = {
    get: (kind: string, key: string) =>
      kind === 'recovery' && key === '$mobile-ready' ? { schema: 1 } : null,
    revision: () => 1,
  };
  const account: any = {
    uid,
    session: {
      phase: () => (open ? 'UNLOCKED' : 'LOCKED'),
      subscribe(listener: any) {
        sessionListeners.add(listener);
        return () => sessionListeners.delete(listener);
      },
      start: () => new Promise<boolean>(resolve => (resolveStart = resolve)),
      use: (operation: any) => {
        if (!open) throw Error('VAULT_LOCKED');
        return operation(store);
      },
    },
    sync: {
      status: () => status,
      subscribe(listener: any) {
        syncListeners.add(listener);
        return () => syncListeners.delete(listener);
      },
      requestSync() {
        status.syncing = true;
        for (const listener of [...syncListeners]) listener({ ...status });
      },
    },
  };
  return {
    account,
    // The resume ends: opened (same boot) or not (after a reboot).
    resume(opened: boolean) {
      open = opened;
      for (const listener of [...sessionListeners])
        listener(account.session.phase());
      resolveStart(opened);
    },
  };
}

function runtimeWith(accounts: Record<string, ReturnType<typeof standIn>>) {
  let listener: ((user: any) => void) | null = null;
  const runtime = {
    account: {
      restore: async () => {
        listener?.({ uid: 'a', username: 'A' });
        return null;
      },
      onChange: (next: any) => (listener = next),
    },
    forAccount: (uid: string) => accounts[uid].account,
    prefs: { load: () => ({ ...defaultPrefs }), save() {} },
  } as unknown as AppRuntime;
  return { runtime, signIn: (uid: string) => listener?.({ uid, username: uid }) };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

test('no stored data: the logo screen waits for the first sync, at most FIRST_SYNC_LIMIT', async () => {
  const a = standIn('a');
  const { runtime } = runtimeWith({ a });
  await render(
    <AppProvider runtime={runtime}>
      <Probe />
    </AppProvider>,
  );
  await act(async () => a.resume(true));
  expect(probe()).toBe('a UNLOCKED loading');
  // No stored list to open after FIRST_SYNC_WAIT.
  await advance(FIRST_SYNC_WAIT + 100);
  expect(probe()).toBe('a UNLOCKED loading');
  // The server never answers: the app opens and shows it waits for the first sync.
  await advance(FIRST_SYNC_LIMIT - FIRST_SYNC_WAIT);
  expect(probe()).toBe('a UNLOCKED open');
});

test("a resume that ends after the account changed does not touch the new account's state", async () => {
  const a = standIn('a');
  const b = standIn('b');
  const { runtime, signIn } = runtimeWith({ a, b });
  await render(
    <AppProvider runtime={runtime}>
      <Probe />
    </AppProvider>,
  );
  expect(probe()).toBe('a LOCKED loading');
  // Signed out and into b while a's resume still runs; b's resume fails (rebooted).
  await act(async () => signIn('b'));
  await act(async () => b.resume(false));
  expect(probe()).toBe('b LOCKED open');
  // a's resume ends late: b keeps its lock screen.
  await act(async () => a.resume(true));
  expect(probe()).toBe('b LOCKED open');
});
