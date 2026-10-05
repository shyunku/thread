/**
 * @format
 */
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

beforeAll(async () => {
  await installE2eePlatform().sodium.ready;
});
let current: ReturnType<typeof createFakeRuntime> | null = null;
afterEach(() => {
  current?.cleanup();
  current = null;
});

test('new account on the phone: sign in, lock, recovery check, then add a task', async () => {
  current = createFakeRuntime();
  await render(<App runtime={current.runtime} />);

  await screen.findByText('로그인');
  await fireEvent.changeText(screen.getByPlaceholderText('아이디'), 'jo');
  await fireEvent.changeText(screen.getByPlaceholderText('비밀번호'), 'wrong');
  await fireEvent.press(screen.getByText('로그인'));
  await screen.findByText('아이디 또는 비밀번호가 맞지 않아요.');
  await fireEvent.changeText(
    screen.getByPlaceholderText('비밀번호'),
    'secret pw',
  );
  await fireEvent.press(screen.getByText('로그인'));

  // Vault lock step, then the server says this is a new account.
  await screen.findByText('이 휴대폰의 데이터 잠금');
  await fireEvent.press(screen.getByText('계속'));
  await screen.findByText('복구 자료를 따로 보관하세요', {}, { timeout: 5000 });
  const material = current.account().workspace.recoveryMaterial();
  expect(screen.getByText(material.code)).toBeTruthy();
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

  // Registered and activated: the task list after the first sync.
  await screen.findByText('모든 할 일', {}, { timeout: 5000 });
  expect(current.server.modes).toEqual({
    accountMode: 'e2ee',
    vaultMode: 'active',
  });
  await waitFor(
    () => expect(screen.queryByText('처음 동기화를 기다리는 중…')).toBeNull(),
    { timeout: 5000 },
  );

  await fireEvent.press(screen.getByLabelText('할 일 추가'));
  await fireEvent.changeText(
    await screen.findByPlaceholderText('새 할 일 제목'),
    '우유 사기',
  );
  await fireEvent.press(screen.getByText('추가'));
  await screen.findByText('우유 사기');
  await waitFor(
    () => expect(current!.server.accepted.length).toBeGreaterThan(0),
    { timeout: 5000 },
  );

  // Completing it moves it to the folded 완료됨 group.
  await fireEvent.press(screen.getByRole('checkbox'));
  await waitFor(() => expect(screen.queryByText('우유 사기')).toBeNull());
  expect(screen.getByText('완료됨 (1)')).toBeTruthy();
  await act(async () => {});
});

// Sign in to a new account and finish the first-device setup.
async function startNewAccount(fake: ReturnType<typeof createFakeRuntime>) {
  await render(<App runtime={fake.runtime} />);
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
  await screen.findByText('모든 할 일', {}, { timeout: 5000 });
  await waitFor(
    () => expect(screen.queryByText('처음 동기화를 기다리는 중…')).toBeNull(),
    { timeout: 5000 },
  );
}

test('a secret category opens only after biometrics/PIN and hides its tasks elsewhere', async () => {
  current = createFakeRuntime();
  await startNewAccount(current);

  // Make a secret category from the view sheet's management screen.
  await fireEvent.press(screen.getByText('모든 할 일'));
  await fireEvent.press(await screen.findByText('카테고리 추가·관리'));
  await fireEvent.changeText(
    await screen.findByPlaceholderText('새 카테고리 이름'),
    '일기',
  );
  await fireEvent(
    screen.getByLabelText('비밀 카테고리로 만들기'),
    'valueChange',
    true,
  );
  await fireEvent.press(screen.getByText('추가'));
  await fireEvent.press(screen.getByLabelText('뒤로'));

  // Locked in the sheet; a failed prompt keeps the current view.
  await fireEvent.press(await screen.findByText('모든 할 일'));
  expect(await screen.findByText('잠김')).toBeTruthy();
  current.keys.state.authAllowed = false;
  await fireEvent.press(screen.getByText('일기'));
  expect(screen.getByText('잠김')).toBeTruthy();
  current.keys.state.authAllowed = true;
  await fireEvent.press(screen.getByText('일기'));
  await screen.findByText(/비밀 카테고리 · 앱을 닫거나 잠그면 다시 잠겨요/);

  // A task added here stays out of the other lists.
  await fireEvent.press(screen.getByLabelText('할 일 추가'));
  await fireEvent.changeText(
    await screen.findByPlaceholderText('새 할 일 제목'),
    '병원 결과 정리',
  );
  await fireEvent.press(screen.getByText('추가'));
  await screen.findByText('병원 결과 정리');
  await fireEvent.press(screen.getByText('일기'));
  await fireEvent.press(await screen.findByText('모든 할 일'));
  await waitFor(() => expect(screen.queryByText('병원 결과 정리')).toBeNull());
  await act(async () => {});
});

// An existing account: phone A (first device) already uses the vault.
async function existingOwner(server: any) {
  const { LocalVault } = require('@/core/vault/localVault');
  const { VaultSession } = require('@/core/vault/session');
  const {
    MobileWorkspace,
    VaultActivity,
    vaultIdFor,
  } = require('@/core/workspace/workspace');
  const { SyncService } = require('@/core/sync/syncService');
  const { createTestDatabases } = require('../jest/testDatabases');
  const { fakeKeychain } = require('../jest/fakeKeychain');
  const dbs = createTestDatabases();
  const vault = new LocalVault(
    {
      environment: 'development',
      accountId: 'u1',
      vaultId: vaultIdFor('development', 'u1'),
    },
    {
      openDatabase: dbs.openDatabase,
      keychain: fakeKeychain().keychain,
      bootId: () => 'count:1',
    },
  );
  const session = new VaultSession(vault);
  await session.create();
  const activity = new VaultActivity();
  const transport = () => server.transport;
  const workspace = new MobileWorkspace({
    session,
    transport,
    reauthenticate: async () => true,
    activity,
  });
  const sync = new SyncService({ session, transport, activity });
  await workspace.prepareIdentity();
  const kit = workspace.recoveryMaterial();
  await workspace.confirmRecovery(kit.code, kit.bytes);
  await workspace.registerIdentity();
  await workspace.activateEmpty();
  await sync.syncNow();
  return {
    workspace,
    cleanup() {
      sync.close();
      session.lock().catch(() => {});
      dbs.cleanup();
    },
  };
}

test('joining an existing account: the 6-digit session survives app re-renders', async () => {
  const { createFakeThreadServer } = require('../jest/fakeThreadServer');
  const { vaultIdFor } = require('@/core/workspace/workspace');
  const server = createFakeThreadServer(vaultIdFor('development', 'u1'));
  const owner = await existingOwner(server);
  current = createFakeRuntime({ server });
  try {
    await render(<App runtime={current.runtime} />);
    await screen.findByText('로그인');
    await fireEvent.changeText(screen.getByPlaceholderText('아이디'), 'jo');
    await fireEvent.changeText(
      screen.getByPlaceholderText('비밀번호'),
      'secret pw',
    );
    await fireEvent.press(screen.getByText('로그인'));
    await fireEvent.press(await screen.findByText('계속'));
    await fireEvent.press(
      await screen.findByText('쓰던 기기와 연결', {}, { timeout: 5000 }),
    );
    await screen.findByText('쓰던 기기를 기다리는 중');

    // The PC opens a session; the phone joins it and both show the code.
    await owner.workspace.relay('ownerStart');
    // The PC reveals its part once the phone's request arrives.
    await waitFor(
      async () =>
        expect((await owner.workspace.relay('ownerPoll')).phase).toBe(
          'COMPARE',
        ),
      { timeout: 8000, interval: 500 },
    );
    await screen.findByText('두 기기의 숫자가 같나요?', {}, { timeout: 5000 });
    // Sync status changes re-render the app; that must not cancel the session.
    await act(async () => {
      await current!
        .account()
        .sync.syncNow()
        .catch(() => null);
    });
    // A cancelled session would show as expired on the PC.
    await new Promise(resolve => setTimeout(resolve, 2000));
    expect((await owner.workspace.relay('ownerPoll')).phase).toBe('COMPARE');
    await fireEvent.press(screen.getByText('같아요'));
    await owner.workspace.relay('ownerApprove');
    await screen.findByText('모든 할 일', {}, { timeout: 8000 });
  } finally {
    owner.cleanup();
  }
}, 30000);
