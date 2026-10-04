import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

// Due dates follow the desktop rules (#95): a new due date starts at the end of the
// day (23:59:59), and changing the day keeps the time already chosen.
export function endOfDay(base: Date) {
  const date = new Date(base);
  date.setHours(23, 59, 59, 0);
  return date.getTime();
}

export function withDay(previous: number | null, day: Date) {
  const next = new Date(day);
  if (previous == null) next.setHours(23, 59, 59, 0);
  else {
    const old = new Date(previous);
    next.setHours(old.getHours(), old.getMinutes(), old.getSeconds(), 0);
  }
  return next.getTime();
}

export const today = () => endOfDay(new Date());
export const tomorrow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return endOfDay(date);
};

const open = (value: Date, mode: 'date' | 'time', is24Hour: boolean) =>
  new Promise<Date | null>(resolve => {
    DateTimePickerAndroid.open({
      value,
      mode,
      is24Hour,
      onChange: (event, date) =>
        resolve(event.type === 'set' && date ? date : null),
    });
  });

// System date picker, then the time picker. Cancelling the time keeps the day with the
// existing (or end-of-day) time; cancelling the day changes nothing.
export async function pickDueDate(
  current: number | null,
  is24Hour = false,
): Promise<number | null | undefined> {
  const day = await open(new Date(current ?? Date.now()), 'date', is24Hour);
  if (!day) return undefined;
  const dated = withDay(current, day);
  const time = await open(new Date(dated), 'time', is24Hour);
  if (!time) return dated;
  const result = new Date(dated);
  result.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return result.getTime();
}
