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
