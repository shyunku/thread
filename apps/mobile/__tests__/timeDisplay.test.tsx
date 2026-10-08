import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import {
  dueText,
  nextTick,
  remainText,
  taskTimeText,
} from '@/core/model/timeDisplay';
import { remainingText } from '@/core/model/view';
import { sanitize, type Prefs } from '@/core/prefs';
import { TimeDisplaySheet } from '@/screens/app/SettingsScreen';

// The first render loads the icon set.
jest.setTimeout(30000);

const mockApp = { prefs: sanitize({}), setPrefs: jest.fn() };
jest.mock('@/app/AppContext', () => ({ useApp: () => mockApp }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;
// Wednesday 2026-10-07 14:58:19, local time (the mock's "now").
const NOW = new Date(2026, 9, 7, 14, 58, 19).getTime();

test('remain: layered units from the largest, zero units left out', () => {
  const samples = [
    D + 4 * H + 12 * M + 8 * S,
    34 * D + 23 * H + 2 * M + 8 * S,
    H + 5 * S,
  ];
  const texts = (format: Prefs['remainFormat']) =>
    samples.map(ms => remainText(ms, format).text);
  expect(texts('simple')).toEqual(['1일 남음', '1개월 남음', '1시간 남음']);
  expect(texts('normal')).toEqual([
    '1일 4시간 남음',
    '1개월 4일 남음',
    '1시간 남음',
  ]);
  expect(texts('detailed')).toEqual([
    '1일 4시간 12분 남음',
    '1개월 4일 23시간 남음',
    '1시간 5초 남음',
  ]);
  expect(texts('all')).toEqual([
    '1일 4시간 12분 8초 남음',
    '1개월 4일 23시간 2분 8초 남음',
    '1시간 5초 남음',
  ]);
  expect(remainText(-(3 * H + 40 * M + 2 * S), 'normal')).toEqual({
    text: '3시간 40분 지남',
    overdue: true,
  });
  expect(remainText(400 * D, 'normal').text).toBe('1년 1개월 남음');
  expect(remainText(0, 'all').text).toBe('0초 남음');
  expect(remainText(500, 'simple').text).toBe('0초 남음');
});

test('remain simple matches the old remainingText', () => {
  for (const ms of [S, 59 * S, M, 61 * M, D - 1, 3 * D, 31 * D, 400 * D])
    for (const diff of [ms, -ms])
      expect(remainText(diff, 'simple')).toEqual(
        remainingText(NOW + diff, NOW),
      );
});

test('due: exact, full, auto and simple wording', () => {
  const at = (days: number, h: number, m: number) =>
    new Date(2026, 9, 7 + days, h, m).getTime();
  const text = (t: number, format: Prefs['dueFormat'], h: '12' | '24' = '12') =>
    dueText(t, NOW, format, h).text;
  expect(text(at(2, 14, 45), 'exact')).toBe('26.10.09 오후 2:45');
  expect(text(at(2, 14, 45), 'exact', '24')).toBe('26.10.09 14:45');
  expect(text(at(2, 14, 45), 'full')).toBe('2026년 10월 9일 오후 2시 45분');
  expect(text(at(2, 14, 45), 'full', '24')).toBe('2026년 10월 9일 14시 45분');
  expect(
    [
      at(0, 15, 20),
      at(1, 17, 30),
      at(2, 15, 0),
      at(-1, 14, 58),
      at(10, 14, 58),
    ].map(t => text(t, 'auto')),
  ).toEqual([
    '오늘 오후 3시 20분',
    '내일 오후 5시 30분',
    '금요일 오후 3시',
    '어제 오후 2시 58분',
    '26.10.17 오후 2:58',
  ]);
  expect(text(at(6, 9, 0), 'auto')).toBe('화요일 오전 9시');
  expect(text(at(-2, 9, 0), 'auto')).toBe('26.10.05 오전 9:00');
  expect(text(at(0, 15, 20), 'auto', '24')).toBe('오늘 15시 20분');
  expect(text(at(0, 0, 5), 'auto')).toBe('오늘 오전 12시 5분');
  expect(text(at(0, 12, 0), 'exact')).toBe('26.10.07 오후 12:00');
  expect(
    [0, 1, -1, -2, 10, 29, 30, 95, 364, 5 * 365 + 3].map(days =>
      text(at(days, 9, 0), 'simple'),
    ),
  ).toEqual([
    '오늘',
    '내일',
    '어제',
    '2일 전',
    '10일 뒤',
    '29일 뒤',
    '1개월 뒤',
    '3개월 뒤',
    '12개월 뒤',
    '5년 뒤',
  ]);
  // Overdue keeps the danger flag in the 기한 mode too.
  expect(dueText(NOW - M, NOW, 'auto', '12').overdue).toBe(true);
  expect(dueText(NOW + M, NOW, 'auto', '12').overdue).toBe(false);
});

test('taskTimeText follows the setting', () => {
  const prefs = sanitize({});
  expect(taskTimeText(null, NOW, prefs)).toBeNull();
  expect(taskTimeText(NOW + D + 4 * H + 5 * M, NOW, prefs)?.text).toBe(
    '1일 4시간 남음',
  );
  expect(
    taskTimeText(NOW + D, NOW, { ...prefs, timeDisplay: 'due' })?.text,
  ).toBe('내일 오후 2시 58분');
});

test('the list ticks every second only while a row shows seconds', () => {
  const tick = (dues: number[], patch: Partial<Prefs> = {}) =>
    nextTick(
      dues.map(d => NOW + d),
      NOW,
      { ...sanitize({}), ...patch },
      60000,
    );
  expect(tick([])).toBe(60000);
  expect(tick([2 * H])).toBe(60000);
  // 보통 shows seconds below an hour: wake when the row gets there.
  expect(tick([H + 30 * S])).toBe(30 * S + 1);
  expect(tick([59 * M])).toBe(S);
  expect(tick([-30 * M])).toBe(S);
  expect(tick([-2 * H])).toBe(60000);
  expect(tick([90 * S], { remainFormat: 'simple' })).toBe(30 * S + 1);
  expect(tick([23 * H], { remainFormat: 'detailed' })).toBe(S);
  expect(tick([400 * D], { remainFormat: 'all' })).toBe(S);
  expect(tick([30 * S], { timeDisplay: 'due' })).toBe(60000);
});

test('prefs keep valid time display values and fall back otherwise', () => {
  expect(sanitize({})).toMatchObject({
    timeDisplay: 'remain',
    remainFormat: 'normal',
    dueFormat: 'auto',
  });
  expect(
    sanitize({ timeDisplay: 'due', remainFormat: 'all', dueFormat: 'full' }),
  ).toMatchObject({
    timeDisplay: 'due',
    remainFormat: 'all',
    dueFormat: 'full',
  });
  expect(
    sanitize({ timeDisplay: 'end', remainFormat: 2, dueFormat: 'auto ' }),
  ).toMatchObject({
    timeDisplay: 'remain',
    remainFormat: 'normal',
    dueFormat: 'auto',
  });
});

describe('시간 표시 sheet', () => {
  // The preview rows are hidden from screen readers.
  const preview = (text: string) =>
    screen.getByText(text, { includeHiddenElements: true });
  const sheet = () =>
    render(
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <TimeDisplaySheet onClose={() => {}} />
      </SafeAreaProvider>,
    );

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    mockApp.prefs = sanitize({});
    mockApp.setPrefs.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  test('remain: preview rows, examples, and a choice saves right away', async () => {
    mockApp.prefs = sanitize({ remainFormat: 'detailed' });
    await sheet();
    expect(
      screen.getByText(
        '할 일 목록과 캘린더 아래 목록에 남은 시간을 얼마나 자세히 보여 줄지 정해요.',
      ),
    ).toBeTruthy();
    expect(preview('2시간 59분 55초 남음')).toBeTruthy();
    expect(preview('1일 4시간 12분 남음')).toBeTruthy();
    expect(
      screen.getByText('1일 4시간 남음 · 1개월 4일 남음 · 1시간 남음'),
    ).toBeTruthy();
    // The preview counts down live.
    await act(() => jest.advanceTimersByTime(1000));
    expect(preview('2시간 59분 54초 남음')).toBeTruthy();

    await fireEvent.press(screen.getByText('모두'));
    expect(mockApp.setPrefs).toHaveBeenLastCalledWith({ remainFormat: 'all' });
    await fireEvent.press(screen.getByText('기한'));
    expect(mockApp.setPrefs).toHaveBeenLastCalledWith({ timeDisplay: 'due' });
  });

  test('due: examples land on round times around today', async () => {
    mockApp.prefs = sanitize({ timeDisplay: 'due' });
    await sheet();
    expect(
      screen.getByText(
        '오늘 오후 3시 20분 · 내일 오후 5시 30분 · 금요일 오후 3시 · 어제 오전 9시 · 26.10.17 오후 3:00',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('오늘 · 내일 · 2일 전 · 10일 뒤 · 3개월 뒤 · 5년 뒤'),
    ).toBeTruthy();
    expect(
      screen.getByText('26.10.09 오후 2:45 · 26.10.08 오후 5:30'),
    ).toBeTruthy();
    // 14:58:19 + 2:59:55 = 17:58:14 today.
    expect(preview('오늘 오후 5시 58분')).toBeTruthy();
    await fireEvent.press(screen.getByText('정확히'));
    expect(mockApp.setPrefs).toHaveBeenLastCalledWith({ dueFormat: 'exact' });
  });
});
