import { dueMs } from "./timeDisplay";

// Repeat rules for the pickers (#102): the periods the data model stores (repeat_period) and
// the "다음" date each choice leads to. Dates may be ms or Date objects (renderer state holds
// Date); 0 and null mean none.
export const REPEAT_PERIODS = Object.freeze(["day", "week", "month", "year"]);
const SHORT_NAMES = Object.freeze({ day: "매일", week: "매주", month: "매월", year: "매년" });
const WEEKDAYS = "일월화수목금토";

// Stored values are "", null or one of REPEAT_PERIODS; anything else means no repeat.
export const normalRepeat = (period) => (REPEAT_PERIODS.includes(period) ? period : null);

// End of the day of `value`, the stored form of "no time" (23:59:59).
export function endOfDay(value) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 0);
  return date.getTime();
}

// List rows use the short word ("매주"); the detail and the pickers name the day.
export const repeatShortName = (period) => SHORT_NAMES[normalRepeat(period)] ?? "";

// "매일" / "매주 수요일" / "매월 21일" / "매년 10월 21일" / "안 함" for a base date.
export function repeatName(period, base) {
  const p = normalRepeat(period);
  if (!p) return "안 함";
  const d = new Date(base);
  if (p === "week") return `매주 ${WEEKDAYS[d.getDay()]}요일`;
  if (p === "month") return `매월 ${d.getDate()}일`;
  if (p === "year") return `매년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  return SHORT_NAMES.day;
}

// The next due date after completing at `now`. Same steps as nextDue in
// packages/e2ee/src/recurrence.js (UTC calendar steps from the anchor, so 31 Oct + 1 month is
// 1 Dec): copied because that module pulls Node-only code into the renderer. The test checks
// both give the same dates.
export function nextRepeatDue(start, due, period, now) {
  const p = normalRepeat(period);
  const from = dueMs(start), current = dueMs(due);
  if (!p || from === null || current === null) return null;
  const until = dueMs(now) ?? Date.now();
  const date = new Date(from);
  for (let i = 0; i < 100000; i++) {
    const value = date.getTime();
    if (value >= until && value > current) return value;
    if (p === "day" || p === "week") date.setUTCDate(date.getUTCDate() + (p === "day" ? 1 : 7));
    else if (p === "month") date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCFullYear(date.getUTCFullYear() + 1);
  }
  return null;
}

// "11월 21일 (토)", with the year when it is not the base date's year.
function nextLabel(next, base) {
  const d = new Date(next), b = new Date(base);
  const year = d.getFullYear() !== b.getFullYear() ? `${d.getFullYear()}년 ` : "";
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

// The repeat picker rows. `base` is the task's due date (or the draft's); without one the rule
// starts from today's end of day, which also becomes the due date. The current period keeps its
// own anchor (repeatStartAt) for its name and its next date, like the list row (TodoItem); the
// others would be anchored on the due date (#102 phase B).
export function repeatOptions({ base = null, value = null, repeatStartAt = null, now = Date.now() } = {}) {
  const at = dueMs(now) ?? Date.now();
  const day = dueMs(base) ?? endOfDay(at);
  const anchor = dueMs(repeatStartAt);
  const current = normalRepeat(value);
  return [null, ...REPEAT_PERIODS].map((period) => {
    if (!period) return { period: null, name: "안 함", next: null, sub: "한 번만", on: current === null };
    const start = period === current && anchor !== null ? anchor : day;
    const next = nextRepeatDue(start, day, period, at);
    return { period, name: repeatName(period, start), next, sub: next ? `다음: ${nextLabel(next, day)}` : "", on: current === period };
  });
}
