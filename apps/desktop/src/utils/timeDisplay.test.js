import { formatClock, formatClockShort, formatDue, formatDueChip, formatDueDetail, formatMinuteOfDay, formatRemain, formatTaskTime, formatTaskTimes, hasDueTime, timeDisplayExamples, timeDisplayOptions } from "./timeDisplay";

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H, MO = 30 * D, Y = 365 * D;

test("remaining time keeps `layers` units from the largest one and drops zero units", () => {
  const ms = D + 4 * H + 12 * M + 8 * S;
  expect(formatRemain(ms, "simple")).toBe("1일 남음");
  expect(formatRemain(ms, "normal")).toBe("1일 4시간 남음");
  expect(formatRemain(ms, "detailed")).toBe("1일 4시간 12분 남음");
  expect(formatRemain(ms, "all")).toBe("1일 4시간 12분 8초 남음");
  const zeroMiddle = H + 5 * S;
  expect(formatRemain(zeroMiddle, "normal")).toBe("1시간 남음");
  expect(formatRemain(zeroMiddle, "detailed")).toBe("1시간 5초 남음");
  expect(formatRemain(zeroMiddle, "all")).toBe("1시간 5초 남음");
  expect(formatRemain(MO + 4 * D + 23 * H + 2 * M + 8 * S, "all")).toBe("1개월 4일 23시간 2분 8초 남음");
  expect(formatRemain(Y + 3 * D, "normal")).toBe("1년 남음");
  expect(formatRemain(Y + 3 * D, "detailed")).toBe("1년 3일 남음");
});

test("overdue says 지남, and nothing left reads 0초", () => {
  expect(formatRemain(-(3 * H + 40 * M + 2 * S), "normal")).toBe("3시간 40분 지남");
  expect(formatRemain(-(3 * H + 40 * M + 2 * S), "all")).toBe("3시간 40분 2초 지남");
  expect(formatRemain(400, "normal")).toBe("0초 남음");
  expect(formatRemain(-400, "simple")).toBe("0초 지남");
  expect(formatRemain(59 * S, "normal")).toBe("59초 남음");
});

test("clock text in 12 and 24 hours, short and long", () => {
  const afternoon = new Date(2026, 9, 9, 14, 45), round = new Date(2026, 9, 9, 15, 0), morning = new Date(2026, 9, 9, 0, 5);
  expect(formatClock(afternoon)).toBe("오후 2:45");
  expect(formatClock(afternoon, "24")).toBe("14:45");
  expect(formatClock(afternoon, "12", true)).toBe("오후 2시 45분");
  expect(formatClock(round, "12", true)).toBe("오후 3시");
  expect(formatClock(round, "24", true)).toBe("15시");
  expect(formatClock(morning)).toBe("오전 12:05");
  expect(formatClock(morning, "24")).toBe("00:05");
  expect(formatClock(new Date(2026, 9, 9, 12, 0), "12", true)).toBe("오후 12시");
});

test("short clock drops :00 as 시 in 12 hours and always shows HH:mm in 24 hours", () => {
  expect(formatClockShort(new Date(2026, 9, 21, 21, 0))).toBe("오후 9시");
  expect(formatClockShort(new Date(2026, 9, 21, 20, 30))).toBe("오후 8:30");
  expect(formatClockShort(new Date(2026, 9, 21, 9, 5))).toBe("오전 9:05");
  expect(formatClockShort(new Date(2026, 9, 21, 0, 0))).toBe("오전 12시");
  expect(formatClockShort(new Date(2026, 9, 21, 12, 0))).toBe("오후 12시");
  expect(formatClockShort(new Date(2026, 9, 21, 21, 0), "24")).toBe("21:00");
  expect(formatClockShort(new Date(2026, 9, 21, 7, 5), "24")).toBe("07:05");
  expect(formatMinuteOfDay(540)).toBe("오전 9:00");
  expect(formatMinuteOfDay(720, "12")).toBe("오후 12:00");
  expect(formatMinuteOfDay(1260, "24")).toBe("21:00");
  expect(formatMinuteOfDay(1260, "12", true)).toBe("오후 9시");
  expect(formatMinuteOfDay(1439, "24")).toBe("23:59");
});

test("detail and chip formats", () => {
  expect(formatDueDetail(new Date(2026, 9, 21, 17, 30))).toBe("2026.10.21 오후 5:30");
  expect(formatDueDetail(new Date(2026, 9, 21, 17, 30).valueOf(), "24")).toBe("2026.10.21 17:30");
  expect(formatDueDetail(new Date(2026, 0, 5, 9, 0))).toBe("2026.01.05 오전 9:00");
  expect(formatDueChip(new Date(2026, 9, 21, 20, 0))).toBe("10월 21일 오후 8시");
  expect(formatDueChip(new Date(2026, 9, 21, 20, 15), "24")).toBe("10월 21일 20:15");
  // End of day means no time was chosen.
  expect(formatDueChip(new Date(2026, 9, 21, 23, 59, 59, 999))).toBe("10월 21일");
  expect(hasDueTime(new Date(2026, 9, 21, 23, 59))).toBe(false);
  expect(hasDueTime(new Date(2026, 9, 21, 23, 58))).toBe(true);
  expect(hasDueTime(new Date(2026, 9, 21, 0, 0))).toBe(true);
});

describe("due dates", () => {
  const now = new Date(2026, 9, 7, 14, 58, 19).valueOf(); // Wednesday
  const at = (days, h, m = 0) => new Date(2026, 9, 7 + days, h, m).valueOf();

  test("exact and full", () => {
    expect(formatDue(at(2, 14, 45), now, "exact")).toBe("26.10.09 오후 2:45");
    expect(formatDue(at(2, 14, 45), now, "exact", "24")).toBe("26.10.09 14:45");
    expect(formatDue(at(1, 17, 30), now, "full")).toBe("2026년 10월 8일 오후 5시 30분");
    expect(formatDue(at(1, 17, 0), now, "full", "24")).toBe("2026년 10월 8일 17시");
  });

  test("auto uses today / tomorrow / yesterday, weekdays 2-6 days ahead, else exact", () => {
    expect(formatDue(at(0, 15, 20), now, "auto")).toBe("오늘 오후 3시 20분");
    expect(formatDue(at(1, 17, 30), now, "auto")).toBe("내일 오후 5시 30분");
    expect(formatDue(at(-1, 18), now, "auto")).toBe("어제 오후 6시");
    expect(formatDue(at(2, 15), now, "auto")).toBe("금요일 오후 3시");
    expect(formatDue(at(6, 9), now, "auto", "24")).toBe("화요일 9시");
    expect(formatDue(at(7, 9), now, "auto")).toBe("26.10.14 오전 9:00");
    expect(formatDue(at(-2, 9), now, "auto")).toBe("26.10.05 오전 9:00");
  });

  test("묶음 맞춤 (group): clock today, 내일/어제, weekday within a week, else the date", () => {
    expect(formatDue(at(0, 21), now)).toBe("오후 9시");
    expect(formatDue(at(0, 20, 30), now, "group")).toBe("오후 8:30");
    expect(formatDue(at(0, 21), now, "group", "24")).toBe("21:00");
    expect(formatDue(at(1, 9), now, "group")).toBe("내일 오전 9시");
    expect(formatDue(at(-1, 18, 15), now, "group")).toBe("어제 오후 6:15");
    expect(formatDue(at(2, 19), now, "group")).toBe("금 오후 7시");
    expect(formatDue(at(6, 19), now, "group", "24")).toBe("화 19:00");
    expect(formatDue(at(7, 19), now, "group")).toBe("10월 14일");
    expect(formatDue(at(-2, 19), now, "group")).toBe("10월 5일");
    expect(formatDue(new Date(2027, 0, 3, 12).valueOf(), now, "group")).toBe("1월 3일");
  });

  test("simple counts calendar days", () => {
    expect(formatDue(at(0, 23, 59), now, "simple")).toBe("오늘");
    expect(formatDue(at(1, 0, 1), now, "simple")).toBe("내일");
    expect(formatDue(at(-1, 23), now, "simple")).toBe("어제");
    expect(formatDue(at(-2, 12), now, "simple")).toBe("2일 전");
    expect(formatDue(at(29, 12), now, "simple")).toBe("29일 뒤");
    expect(formatDue(at(95, 12), now, "simple")).toBe("3개월 뒤");
    expect(formatDue(at(-400, 12), now, "simple")).toBe("1년 전");
  });

  test("examples land on round times relative to today", () => {
    expect(timeDisplayExamples("due", "group", now)).toBe("오후 9시 · 금 오후 7시 · 10월 16일");
    expect(timeDisplayExamples("due", "group", now, "24")).toBe("21:00 · 금 19:00 · 10월 16일");
    expect(timeDisplayExamples("due", "simple", now)).toBe("오늘 · 2일 뒤 · 9일 뒤");
    expect(timeDisplayExamples("due", "auto", now)).toBe("오늘 오후 9시 · 금요일 오후 7시 · 26.10.16 오후 6:00");
    expect(timeDisplayExamples("due", "exact", now, "24")).toBe("26.10.07 21:00 · 26.10.09 19:00 · 26.10.16 18:00");
    expect(timeDisplayExamples("due", "full", now)).toBe("2026년 10월 7일 오후 9시 · 2026년 10월 9일 오후 7시 · 2026년 10월 16일 오후 6시");
    expect(timeDisplayExamples("remain", "simple", now)).toBe("3시간 남음 · 1일 남음");
    expect(timeDisplayExamples("remain", "normal", now)).toBe("3시간 30분 남음 · 1일 4시간 남음");
    expect(timeDisplayExamples("remain", "detailed", now)).toBe("3시간 30분 남음 · 1일 4시간 12분 남음");
    expect(timeDisplayExamples("remain", "all", now)).toBe("3시간 30분 남음 · 1일 4시간 12분 8초 남음");
  });
});

test("task time follows the prefs and falls back to defaults", () => {
  const now = new Date(2026, 9, 7, 14, 58, 19).valueOf();
  const due = now + 2 * H + 59 * M + 55 * S;
  expect(formatTaskTime(due, now, {})).toBe("2시간 59분 남음");
  expect(formatTaskTime(due, now, { remainFormat: "all" })).toBe("2시간 59분 55초 남음");
  // With the remaining time off, single-text lines show the due instead.
  expect(formatTaskTime(due, now, { showRemain: false })).toBe("오후 5:58");
  expect(formatTaskTime(due, now, { showRemain: false, dueFormat: "auto" })).toBe("오늘 오후 5시 58분");
  expect(formatTaskTime(due, now, { showRemain: false, dueFormat: "exact", timeFormat: "24" })).toBe("26.10.07 17:58");
  expect(timeDisplayOptions({ timeDisplay: "x", remainFormat: 3, dueFormat: null })).toEqual({ showRemain: true, timeDisplay: "remain", remainFormat: "normal", dueFormat: "group", timeFormat: "12" });
  // Prefs from before #102 that never went through the migration.
  expect(timeDisplayOptions({ timeDisplay: "due" })).toMatchObject({ showRemain: false, timeDisplay: "due" });
  expect(timeDisplayOptions({ timeDisplay: "due", showRemain: true })).toMatchObject({ showRemain: true, timeDisplay: "remain" });
});

test("the two-line column gives the due on top and the remaining time below when shown", () => {
  const now = new Date(2026, 9, 7, 14, 58, 19).valueOf();
  expect(formatTaskTimes(new Date(2026, 9, 7, 21, 0), now, {})).toEqual({ due: "오후 9시", remain: "6시간 1분 남음", overdue: false });
  expect(formatTaskTimes(new Date(2026, 9, 7, 9, 0), now, { timeFormat: "24", remainFormat: "simple" })).toEqual({ due: "09:00", remain: "5시간 지남", overdue: true });
  expect(formatTaskTimes(new Date(2026, 9, 8, 9, 0), now, { showRemain: false })).toEqual({ due: "내일 오전 9시", remain: null, overdue: false });
});
