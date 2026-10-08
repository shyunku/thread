import { formatClock, formatDue, formatRemain, formatTaskTime, timeDisplayExamples, timeDisplayOptions } from "./timeDisplay";

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
    expect(timeDisplayExamples("due", "auto", now)).toBe("오늘 오후 3시 20분 · 내일 오후 5시 30분 · 금요일 오후 3시 · 어제 오후 6시 · 26.10.17 오후 2:00");
    expect(timeDisplayExamples("due", "simple", now)).toBe("오늘 · 내일 · 2일 전 · 10일 뒤 · 3개월 뒤 · 5년 뒤");
    expect(timeDisplayExamples("due", "exact", now, "24")).toBe("26.10.09 14:45 · 26.10.08 17:30");
    expect(timeDisplayExamples("due", "full", now)).toBe("2026년 10월 9일 오후 2시 45분 · 2026년 10월 8일 오후 5시 30분");
    expect(timeDisplayExamples("remain", "detailed", now)).toBe("1일 4시간 12분 남음 · 1개월 4일 23시간 남음 · 1시간 5초 남음");
  });
});

test("task time follows the prefs and falls back to defaults", () => {
  const now = new Date(2026, 9, 7, 14, 58, 19).valueOf();
  const due = now + 2 * H + 59 * M + 55 * S;
  expect(formatTaskTime(due, now, {})).toBe("2시간 59분 남음");
  expect(formatTaskTime(due, now, { timeDisplay: "remain", remainFormat: "all" })).toBe("2시간 59분 55초 남음");
  expect(formatTaskTime(due, now, { timeDisplay: "due" })).toBe("오늘 오후 5시 58분");
  expect(formatTaskTime(due, now, { timeDisplay: "due", dueFormat: "exact", timeFormat: "24" })).toBe("26.10.07 17:58");
  expect(timeDisplayOptions({ timeDisplay: "x", remainFormat: 3, dueFormat: null })).toEqual({ timeDisplay: "remain", remainFormat: "normal", dueFormat: "auto", timeFormat: "12" });
});
