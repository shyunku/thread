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
