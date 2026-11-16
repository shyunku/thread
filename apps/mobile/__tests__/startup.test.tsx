/**
 * @format
 */
// Start-up (#112, report M1): the logo screen until the account is restored, the vault
// reopened and the first sync ended (or 5 seconds with stored data); the lock screen only
// after a reboot, without the UNLOCK_IN_PROGRESS error.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import App from '../src/app/App';
import { installE2eePlatform } from '@/core/e2ee/platform';
import { createFakeRuntime } from '../jest/fakeRuntime';

jest.mock('@/core/files', () => ({
  copySecret: jest.fn(),
  saveRecoveryFile: jest.fn(async () => true),
  pickRecoveryFile: jest.fn(),
}));
const files = require('@/core/files');

// Counts lock screens drawn by the app (the real screen inside).
const mockLock = { shown: 0 };
jest.mock('@/screens/setup/LockScreen', () => {
  const actual = jest.requireActual('@/screens/setup/LockScreen').default;
  const React = require('react');
  return {
    __esModule: true,
    default: (props: any) => {
      mockLock.shown++;
      return React.createElement(actual, props);
    },
  };
});

jest.setTimeout(40000);
const LOADING = '불러오는 중';
const sleep = (ms: number) =>
  act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));

beforeAll(async () => {
  await installE2eePlatform().sodium.ready;
});
let current: ReturnType<typeof createFakeRuntime> | null = null;
afterEach(() => {
  current?.release();
  current?.cleanup();
  current = null;
  mockLock.shown = 0;
});

// A new account set up on this phone, with one task, then the app closed.
async function setUpAndClose(fake: ReturnType<typeof createFakeRuntime>) {
  const view = await render(<App runtime={fake.runtime} />);
  await screen.findByText('로그인');
  await fireEvent.changeText(screen.getByPlaceholderText('아이디'), 'jo');
  await fireEvent.changeText(
    screen.getByPlaceholderText('비밀번호'),
    'secret pw',
  );
  await fireEvent.press(screen.getByText('로그인'));
  await screen.findByText('이 휴대폰의 데이터 잠금');
  await fireEvent.press(screen.getByText('계속'));
  await screen.findByText('복구 자료를 따로 보관하세요', {}, { timeout: 5000 });
  const material = fake.account().workspace.recoveryMaterial();
  await fireEvent.press(screen.getByText('보관했어요'));
  await screen.findByText('제대로 보관했는지 확인할게요');
  files.pickRecoveryFile.mockResolvedValue({
    name: 'thread_recovery.trec',
    bytes: material.bytes,
  });
  await fireEvent.press(screen.getByText('복구 파일 고르기'));
  await screen.findByText('thread_recovery.trec');
  await fireEvent.changeText(
    screen.getByPlaceholderText('복구 코드 (THREAD1-…)'),
    material.code,
  );
  await fireEvent.press(screen.getByText('확인하고 시작하기'));
  // A first connection waits on the logo screen for its first sync: no empty list.
  await screen.findByText('모든 할 일', {}, { timeout: 8000 });
  expect(screen.queryByText('처음 동기화를 기다리는 중…')).toBeNull();
  await fireEvent.press(screen.getByLabelText('할 일 추가'));
  await fireEvent.changeText(
    await screen.findByPlaceholderText('새 할 일 제목'),
    '우유 사기',
  );
  await fireEvent.press(screen.getByText('추가'));
  await screen.findByText('우유 사기');
  await waitFor(
    () => expect(fake.server.accepted.length).toBeGreaterThan(0),
    { timeout: 5000 },
  );
  await act(async () => {
    await fake
      .account()
      .sync.syncNow()
      .catch(() => null);
  });
  await view.unmount();
}

test('same boot: the logo screen until the first sync, never the lock screen or its error', async () => {
  current = createFakeRuntime();
  await setUpAndClose(current);
  mockLock.shown = 0;

  current.restart();
  // The Keystore answers slowly, like on a phone; the server holds the first sync.
  current.keys.state.delay = 40;
  current.net.hold = true;
  await render(<App runtime={current.runtime} />);
  expect(screen.getByLabelText(LOADING)).toBeTruthy();
  await sleep(1500);
  // Reopened (the stored list is ready) but still waiting for the sync.
  expect(current.account().session.phase()).toBe('UNLOCKED');
  expect(screen.getByLabelText(LOADING)).toBeTruthy();
  expect(screen.queryByText('모든 할 일')).toBeNull();

  current.release();
  await screen.findByText('우유 사기', {}, { timeout: 5000 });
  expect(screen.queryByLabelText(LOADING)).toBeNull();
  expect(mockLock.shown).toBe(0);
  expect(screen.queryByText(/UNLOCK_IN_PROGRESS|문제가 생겼어요/)).toBeNull();

  // Later syncs (a return to the foreground starts one) keep the list on screen.
  const sync = current.account().sync;
  let syncing = false;
  const off = sync.subscribe((status: any) => {
    if (status.syncing) syncing = true;
  });
  await act(async () => {
    sync.requestSync();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByLabelText(LOADING)).toBeNull();
    await sync.syncNow().catch(() => null);
  });
  off();
  expect(syncing).toBe(true);
  expect(screen.queryByLabelText(LOADING)).toBeNull();
  expect(screen.getByText('우유 사기')).toBeTruthy();
});

test('a slow first sync: the stored list opens after 5 seconds, still syncing', async () => {
  current = createFakeRuntime();
  await setUpAndClose(current);
  current.restart();
  current.net.hold = true;
  await render(<App runtime={current.runtime} />);
  await sleep(4000);
  expect(screen.getByLabelText(LOADING)).toBeTruthy();
  await screen.findByText('우유 사기', {}, { timeout: 3000 });
  expect(screen.getByText(/동기화 중/)).toBeTruthy();
  current.release();
});

test('offline: the stored list opens as soon as the sync fails', async () => {
  current = createFakeRuntime();
  await setUpAndClose(current);
  current.restart();
  current.net.offline = true;
  const started = Date.now();
  await render(<App runtime={current.runtime} />);
  await screen.findByText('우유 사기', {}, { timeout: 4000 });
  expect(Date.now() - started).toBeLessThan(4000);
  await screen.findByText(/오프라인/);
});

test('after a reboot: the lock screen asks right away, then the logo screen until the first sync', async () => {
  current = createFakeRuntime();
  await setUpAndClose(current);
  current.restart({ reboot: true });
  current.keys.state.delay = 300;
  current.net.hold = true;
  const reads = current.keys.state.authReads;
  await render(<App runtime={current.runtime} />);
  await screen.findByText('Thread가 잠겨 있어요');
  // The biometric prompt opened by itself; no red error text.
  await waitFor(() => expect(current!.keys.state.authReads).toBe(reads + 1));
  expect(screen.queryByText(/문제가 생겼어요/)).toBeNull();

  // Unlocked: the logo screen while the first sync runs, then the list.
  await screen.findByLabelText(LOADING, {}, { timeout: 3000 });
  expect(screen.queryByText('Thread가 잠겨 있어요')).toBeNull();
  current.release();
  await screen.findByText('우유 사기', {}, { timeout: 5000 });
});
