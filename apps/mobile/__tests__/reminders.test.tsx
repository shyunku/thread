import { fireEvent, render, screen } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { sanitize } from '@/core/prefs';
import { scheduleReminders } from '@/core/reminders';
import { ReminderGroup } from '@/screens/app/ReminderSettings';

// Due reminders (#91) on the phone: the settings, and the list handed to the native side.
jest.setTimeout(30000);

const native = {
  schedule: jest.fn(),
  status: jest.fn(() => Promise.resolve({ enabled: false, exact: true })),
  openNotificationSettings: jest.fn(),
  openExactAlarmSettings: jest.fn(),
  takeOpenedTask: jest.fn(() => null),
};
NativeModules.ThreadReminders = native;

const mockApp: any = {
  prefs: sanitize({}),
  setPrefs: jest.fn((patch: any) => {
    mockApp.prefs = { ...mockApp.prefs, ...patch };
  }),
  runtime: { reminders: { askPermission: jest.fn(() => Promise.resolve(true)) } },
};
jest.mock('@/app/AppContext', () => ({ useApp: () => mockApp }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockApp.prefs = sanitize({});
});

test('defaults: 10 minutes before on, at the due time off; bad stored values fall back', () => {
  expect(sanitize({}).reminders).toEqual({
    enabled: true,
    before: true,
    minutes: 10,
    due: false,
  });
  expect(sanitize({ reminders: { before: true, minutes: 7 } }).reminders.minutes).toBe(10);
  expect(sanitize({}).notifyAsked).toBe(false);
});

test('the native side gets the text, secret tasks without a title, soonest first', () => {
  const NOW = new Date(2026, 9, 24, 14, 0).getTime();
  const at = (h: number) => new Date(2026, 9, 24, h, 0).getTime();
  scheduleReminders(
    {
      tasks: [
        { tid: 's', title: '비밀 일', due_date: at(16) },
        { tid: 'm', title: '회의', due_date: at(15) },
      ],
      subtasks: [],
      categories: [{ cid: 'x', title: '일기', secret: true }],
      relations: [{ tid: 's', cid: 'x' }],
    },
    sanitize({}).reminders,
    '12',
    NOW,
  );
  const items = JSON.parse(native.schedule.mock.calls[0][0]);
  expect(items.map((i: any) => [i.id, i.title, i.body])).toEqual([
    ['m:before', '회의', '오후 3:00까지 · 10분 남음'],
    ['s:before', '할 일 1개의 기한이 10분 남았어요', ''],
  ]);
});

test('settings: the permission-off line asks first, then opens the system settings', async () => {
  await render(<ReminderGroup />);
  const allow = await screen.findByText('허용');
  expect(screen.getByText('알림 권한이 꺼져 있어요')).toBeTruthy();
  await fireEvent.press(allow);
  expect(mockApp.setPrefs).toHaveBeenCalledWith({ notifyAsked: true });
  expect(mockApp.runtime.reminders.askPermission).toHaveBeenCalled();
  await fireEvent(screen.getByLabelText('기한 시각에 알림'), 'valueChange', true);
  expect(mockApp.setPrefs).toHaveBeenLastCalledWith({
    reminders: { enabled: true, before: true, minutes: 10, due: true },
  });
});
