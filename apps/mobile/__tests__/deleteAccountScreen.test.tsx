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

const ACK = '모든 기기의 데이터가 지워지는 것을 이해했어요';

beforeAll(async () => {
  await installE2eePlatform().sodium.ready;
});
let current: ReturnType<typeof createFakeRuntime> | null = null;
afterEach(() => {
  current?.cleanup();
  current = null;
});

// Sign in to a new account, finish the first-device setup and open 설정.
async function signedIn(
  fake: ReturnType<typeof createFakeRuntime>,
  vaultPassword?: string,
) {
  await render(<App runtime={fake.runtime} />);
  await screen.findByText('로그인');
  await fireEvent.changeText(screen.getByPlaceholderText('아이디'), 'jo');
  await fireEvent.changeText(
    screen.getByPlaceholderText('비밀번호'),
    'secret pw',
  );
  await fireEvent.press(screen.getByText('로그인'));
  await screen.findByText('이 휴대폰의 데이터 잠금');
  if (vaultPassword) {
    await fireEvent.press(screen.getByText('+ 비밀번호도 함께'));
    await fireEvent.changeText(
      screen.getByPlaceholderText('비밀번호 (12자 이상)'),
      vaultPassword,
    );
    await fireEvent.changeText(
      screen.getByPlaceholderText('비밀번호 확인'),
      vaultPassword,
    );
  }
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
  await fireEvent.press(screen.getAllByText('설정').at(-1)!);
  await screen.findByText('계정과 모든 기기의 할 일을 지워요');
}

const killButton = (label = '계정 삭제 (지문·PIN)') =>
  screen.getByRole('button', { name: label });

test('설정 → 계정 삭제: the red button waits for the check and biometrics, then the login screen says it is done', async () => {
  current = createFakeRuntime();
  await signedIn(current);
  const vault = current.account().vault;

  await fireEvent.press(screen.getByText('계정과 모든 기기의 할 일을 지워요'));
  await screen.findByText('계정을 삭제할까요?');
  expect(screen.getByText('• 모든 기기의 할 일과 카테고리')).toBeTruthy();
  expect(
    screen.getByText(/PC 앱의 설정 → 데이터 → 데이터 백업으로/),
  ).toBeTruthy();
  expect(killButton()).toBeDisabled();
  await fireEvent.press(screen.getByText(ACK));
  expect(killButton()).toBeEnabled();

  // A failed prompt (no vault password here) deletes nothing.
  current.keys.state.authAllowed = false;
  await fireEvent.press(killButton());
  await screen.findByText('확인을 취소했거나 실패했어요.');
  expect(current.deleteCalls()).toBe(0);

  // The server is down: the error is shown and the account stays.
  current.keys.state.authAllowed = true;
  current.setDeleteResult('ACCOUNT_DELETE_UNAVAILABLE');
  await fireEvent.press(killButton());
  await screen.findByText('계정을 삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  expect(current.deleteCalls()).toBe(1);
  expect(vault.inspect().phase).not.toBe('ABSENT');

  current.setDeleteResult('ok');
  await fireEvent.press(killButton());
  await screen.findByText('계정을 삭제했어요', {}, { timeout: 5000 });
  expect(screen.getByText('로그인')).toBeTruthy();
  expect(vault.inspect().phase).toBe('ABSENT');
  expect(current.dbs.exists(`vault-${vault.id}.db`)).toBe(false);
  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(screen.queryByText('계정을 삭제했어요')).toBeNull();
  await act(async () => {});
});

test('when biometrics/PIN fail, the vault password confirms instead', async () => {
  current = createFakeRuntime();
  await signedIn(current, 'synthetic vault pw');
  const vault = current.account().vault;
  await fireEvent.press(screen.getByText('계정과 모든 기기의 할 일을 지워요'));
  await screen.findByText('지문·PIN이 안 되면 보관함 비밀번호로 확인해요.');
  await fireEvent.press(screen.getByText(ACK));
  current.keys.state.authAllowed = false;
  await fireEvent.press(killButton());
  await screen.findByText(/보관함 비밀번호를 입력해 주세요/);
  const kill = killButton('비밀번호로 계정 삭제');
  expect(kill).toBeDisabled();
  await fireEvent.changeText(
    screen.getByPlaceholderText('보관함 비밀번호'),
    'wrong password!!',
  );
  await fireEvent.press(killButton('비밀번호로 계정 삭제'));
  await screen.findByText('비밀번호가 맞지 않아요.', {}, { timeout: 10000 });
  expect(current.deleteCalls()).toBe(0);
  await fireEvent.changeText(
    screen.getByPlaceholderText('보관함 비밀번호'),
    'synthetic vault pw',
  );
  await fireEvent.press(killButton('비밀번호로 계정 삭제'));
  await screen.findByText('계정을 삭제했어요', {}, { timeout: 10000 });
  expect(current.deleteCalls()).toBe(1);
  expect(vault.inspect().phase).toBe('ABSENT');
  await act(async () => {});
});

test('취소 goes back without deleting', async () => {
  current = createFakeRuntime();
  await signedIn(current);
  await fireEvent.press(screen.getByText('계정과 모든 기기의 할 일을 지워요'));
  await screen.findByText('계정을 삭제할까요?');
  await fireEvent.press(screen.getByText('취소'));
  await waitFor(() => expect(screen.queryByText('계정을 삭제할까요?')).toBeNull());
  expect(current.deleteCalls()).toBe(0);
  await act(async () => {});
});

test('deleted on another device: the phone goes to the login screen with its own line', async () => {
  current = createFakeRuntime();
  await signedIn(current);
  const vault = current.account().vault;
  await act(async () => {
    await current!.deletedElsewhere();
  });
  await screen.findByText('계정이 삭제됐어요');
  expect(vault.inspect().phase).toBe('ABSENT');
  // Signing in again clears the line.
  await act(async () => {});
});
