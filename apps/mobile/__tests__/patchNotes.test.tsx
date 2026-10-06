import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import {
  APP_VERSION,
  compareVersions,
  pendingNotes,
  platformNotes,
  type PatchNote,
} from '@/core/patchNotes';
import { sanitize } from '@/core/prefs';
import { PatchNotesSheet } from '@/screens/app/PatchNotesScreen';

// The first render loads the icon set.
jest.setTimeout(30000);

const mockApp = { prefs: {} as any, setPrefs: jest.fn() };
jest.mock('@/app/AppContext', () => ({ useApp: () => mockApp }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const [major, minor, patch] = APP_VERSION.split('.').map(Number);
// 0, 1: newer than the running version; 2: running; 3+: older (major - 1).
const version = (back: number) =>
  back <= 2
    ? `${major}.${minor}.${patch + 2 - back}`
    : `${major - 1}.9.${12 - back}`;
const note = (v: string): PatchNote => ({
  version: v,
  date: '2026-10-20',
  summary: `${v} 요약`,
  sections: [
    {
      kind: 'fixed',
      items: [{ title: `${v} 문제를 고쳤어요.`, detail: ['한 줄.'] }],
    },
  ],
});
// Two versions newer than the running one, the running one, and older ones.
const NOTES = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => note(version(n)));
const older = (n: number) => version(2 + n);

const sheet = () =>
  render(
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <PatchNotesSheet notes={NOTES} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockApp.setPrefs.mockClear();
  mockNavigate.mockClear();
});

test('versions compare numerically and pending notes stop at the running version', () => {
  expect(compareVersions('2.0.10', '2.0.9')).toBeGreaterThan(0);
  expect(compareVersions('2.1.0-beta.1', '2.1.0')).toBeLessThan(0);
  expect(
    pendingNotes(NOTES, older(2), APP_VERSION).map(n => n.version),
  ).toEqual([APP_VERSION, older(1)]);
  expect(pendingNotes(NOTES, '', APP_VERSION).map(n => n.version)).toEqual([
    APP_VERSION,
  ]);
  expect(platformNotes({ android: [NOTES[0]], ios: [] }, 'ios')).toEqual([]);
  expect(
    sanitize({ patchNotesSeen: '../x', showPatchNotes: 'no' }),
  ).toMatchObject({ patchNotesSeen: '', showPatchNotes: true });
});

test('after an update the sheet lists unseen versions; 다시 보지 않기 turns it off', async () => {
  mockApp.prefs = { showPatchNotes: true, patchNotesSeen: older(2) };
  await sheet();
  expect(screen.getByText('업데이트를 완료했어요')).toBeTruthy();
  expect(screen.getByText(`${APP_VERSION} 문제를 고쳤어요.`)).toBeTruthy();
  expect(screen.getByText(`${older(1)} 문제를 고쳤어요.`)).toBeTruthy();
  expect(screen.queryByText(`${older(2)} 요약`)).toBeNull();
  await fireEvent.press(screen.getByText('다시 보지 않기'));
  await fireEvent.press(screen.getByText('확인'));
  expect(mockApp.setPrefs).toHaveBeenCalledWith({
    patchNotesSeen: APP_VERSION,
    showPatchNotes: false,
  });
});

test('five or more versions are collapsed cards; 전체 내역 opens the history', async () => {
  mockApp.prefs = { showPatchNotes: true, patchNotesSeen: older(6) };
  await sheet();
  expect(screen.getByText(`${older(5)} 요약`)).toBeTruthy();
  expect(screen.queryByText(`${APP_VERSION} 문제를 고쳤어요.`)).toBeNull();
  await fireEvent.press(screen.getByText(`${APP_VERSION} 요약`));
  expect(screen.getByText(`${APP_VERSION} 문제를 고쳤어요.`)).toBeTruthy();
  await fireEvent.press(screen.getByText('전체 내역'));
  expect(mockApp.setPrefs).toHaveBeenCalledWith({
    patchNotesSeen: APP_VERSION,
  });
  expect(mockNavigate).toHaveBeenCalledWith('PatchNotes');
});

test('nothing shows when turned off or already seen', async () => {
  mockApp.prefs = { showPatchNotes: false, patchNotesSeen: older(1) };
  const first = await sheet();
  expect(screen.queryByText('업데이트를 완료했어요')).toBeNull();
  expect(mockApp.setPrefs).toHaveBeenCalledWith({
    patchNotesSeen: APP_VERSION,
  });
  await first.unmount();
  mockApp.setPrefs.mockClear();
  mockApp.prefs = { showPatchNotes: true, patchNotesSeen: APP_VERSION };
  await sheet();
  expect(screen.queryByText('업데이트를 완료했어요')).toBeNull();
  expect(mockApp.setPrefs).not.toHaveBeenCalled();
});
