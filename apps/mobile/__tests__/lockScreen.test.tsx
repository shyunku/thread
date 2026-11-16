import { render, screen, waitFor } from '@testing-library/react-native';
import LockScreen from '@/screens/setup/LockScreen';

// The lock screen asks right away; an open still running or a lock that won over it is
// not an error to show (#112, report M1 fix B).
jest.setTimeout(30000);

const mockUnlock = jest.fn();
jest.mock('@/app/AppContext', () => ({
  useApp: () => ({
    account: {
      session: { unlock: mockUnlock, unlockWithPassword: mockUnlock },
      vault: { inspect: () => ({ passwordAvailable: false }) },
    },
    user: { username: 'jo' },
    runtime: { signOut: jest.fn() },
  }),
}));

const failWith = (code: string) =>
  mockUnlock.mockReset().mockImplementation(async () => {
    throw Error(code);
  });

test.each(['UNLOCK_IN_PROGRESS', 'UNLOCK_CANCELLED'])(
  'no red text for %s',
  async code => {
    failWith(code);
    await render(<LockScreen />);
    await waitFor(() => expect(mockUnlock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/문제가 생겼어요/)).toBeNull();
    expect(screen.queryByText(new RegExp(code))).toBeNull();
  },
);

test('other errors are still shown', async () => {
  failWith('AUTH_CANCELLED');
  await render(<LockScreen />);
  await screen.findByText('확인을 취소했어요.');
});
