import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

const {
  planReminders,
  reminderText,
  normalReminders,
  DEFAULT_REMINDERS,
  MINUTE_CHOICES,
} = require('@thread/e2ee/src/model/reminders');

// Due reminders (#91): the app plans them from the lists (packages/e2ee model/reminders) and
// hands the list to the native side (ThreadReminders: Android alarms, iOS local notifications),
// which keeps them across app restarts. Ordinary tasks carry their title (the user's choice);
// secret ones never do.

export type ReminderSettings = {
  enabled: boolean;
  before: boolean;
  minutes: number;
  due: boolean;
};
export const defaultReminders: ReminderSettings = { ...DEFAULT_REMINDERS };
export const reminderMinutes: number[] = MINUTE_CHOICES;
export const sanitizeReminders = (value: unknown): ReminderSettings =>
  normalReminders(value);

// Read when used, so a late registration (tests) is seen.
const mod = () => NativeModules.ThreadReminders;
// iOS keeps at most 64 pending notifications; Android limits alarms per app.
const LIMIT = Platform.OS === 'ios' ? 64 : 300;

export function scheduleReminders(
  lists: any,
  settings: ReminderSettings,
  timeFormat: '12' | '24',
  now = Date.now(),
) {
  const native = mod();
  if (!native?.schedule) return;
  const plan = lists ? planReminders(lists, settings, { now, limit: LIMIT }) : [];
  native.schedule(
    JSON.stringify(
      plan.map((item: any) => ({
        id: item.id,
        tid: item.tid,
        at: item.at,
        ...reminderText(item, { timeFormat }),
      })),
    ),
  );
}

export type ReminderStatus = { enabled: boolean; exact: boolean };
export async function reminderStatus(): Promise<ReminderStatus> {
  try {
    const value = await mod()?.status?.();
    return { enabled: !!value?.enabled, exact: value?.exact !== false };
  } catch {
    return { enabled: false, exact: true };
  }
}

// The OS permission prompt (Android 13+, iOS). Older Android allows notifications by default.
export async function askReminderPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') return !!(await mod()?.requestPermission?.());
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const result = await PermissionsAndroid.request(
        'android.permission.POST_NOTIFICATIONS' as any,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  } catch {
    return false;
  }
}

export const openNotificationSettings = () =>
  mod()?.openNotificationSettings?.();
export const openExactAlarmSettings = () => mod()?.openExactAlarmSettings?.();

// The task of the notification that opened the app: once at start, then on each tap.
export function onReminderOpen(handler: (tid: string) => void): () => void {
  const native = mod();
  if (!native) return () => {};
  const take = () => {
    const tid = native.takeOpenedTask?.();
    if (typeof tid === 'string' && tid) handler(tid);
  };
  take();
  const subscription = new NativeEventEmitter(native).addListener(
    'ThreadReminderOpen',
    take,
  );
  return () => subscription.remove();
}
