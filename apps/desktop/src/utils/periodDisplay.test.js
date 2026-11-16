import Task from "objects/Task";
import { clockRange, periodChipText, periodClockText, periodLeft, periodProgress, periodRepeatName, periodText, startDetailText } from "./periodDisplay";

const at = (m, d, h = 0, min = 0, s = 0) => new Date(2026, m - 1, d, h, min, s).getTime();
const end = (m, d) => at(m, d, 23, 59, 59);
const NOW = at(11, 10, 13, 20); // Tue
const task = (start, due, extra = {}) => Object.assign(Task.fromEntity({ tid: "t", title: "x", due_date: due, start_offset: start === null ? 0 : due - start }), extra);

test("row text: days, or the clocks inside one day", () => {
  expect(periodText(task(at(11, 9), end(11, 12)), "12", NOW)).toBe("11.09 ~ 11.12");
  expect(periodText(task(at(11, 9, 9), at(11, 13, 18)), "12", NOW)).toBe("11.09 ~ 11.13");
  expect(periodText(task(at(11, 10, 14), at(11, 10, 17)), "12", NOW)).toBe("오후 2시 ~ 5시");
  expect(periodText(task(at(11, 10, 11), at(11, 10, 13, 30)), "12", NOW)).toBe("오전 11시 ~ 오후 1:30");
  expect(periodText(task(at(11, 10, 14), end(11, 10)), "12", NOW)).toBe("오후 2시 ~ 하루 끝");
  expect(periodText(task(at(11, 10, 14), at(11, 10, 17)), "24", NOW)).toBe("14:00 ~ 17:00");
  expect(periodText(task(null, end(11, 12)), "12", NOW)).toBe("");
  expect(clockRange(at(11, 10, 14), at(11, 10, 17), "12", true)).toBe("오후 2:00 ~ 5:00");
});

test("second line: N 뒤 시작, N 뒤 종료, N 지남 from the end", () => {
  expect(periodLeft(task(at(11, 10, 14), at(11, 10, 17)), NOW)).toEqual({ text: "40분 뒤 시작", tone: "soon" });
  expect(periodLeft(task(at(11, 9), end(11, 12)), NOW)).toEqual({ text: "2일 10시간 뒤 종료", tone: "" });
  expect(periodLeft(task(at(11, 5), at(11, 9, 12)), NOW)).toEqual({ text: "1일 1시간 지남", tone: "over" });
  expect(periodLeft(task(at(11, 9), end(11, 12)), NOW, "simple").text).toBe("2일 뒤 종료");
  expect(periodLeft(task(null, end(11, 12)), NOW)).toBeNull();
});

test("진행: days for several days, percent inside one, 완료 and 지남", () => {
  expect(periodProgress(task(at(11, 9), end(11, 12)), NOW)).toMatchObject({ label: "4일 중 2일째", over: false });
  const day = periodProgress(task(at(11, 10, 12), at(11, 10, 16)), NOW);
  expect(day).toMatchObject({ label: "33% · 2시간 40분 뒤 종료" });
  expect(day.progress).toBeCloseTo(1 / 3);
  expect(periodProgress(task(at(11, 10, 14), at(11, 10, 17)), NOW)).toEqual({ progress: 0, label: "40분 뒤 시작", over: false });
  expect(periodProgress(task(at(11, 5), at(11, 9, 12)), NOW)).toEqual({ progress: 1, label: "1일 1시간 지남", over: true });
  expect(periodProgress(task(at(11, 5), at(11, 9, 12)), NOW, true)).toEqual({ progress: 1, label: "완료", over: false });
});

test("detail start, weekly repeat of a period, quick-add chip", () => {
  expect(startDetailText(at(11, 9))).toBe("2026.11.09 · 하루 시작");
  expect(startDetailText(at(11, 9, 9))).toBe("2026.11.09 오전 9:00");
  const sprint = task(at(11, 9, 9), at(11, 13, 18));
  expect(periodRepeatName("week", sprint, at(11, 13, 18))).toBe("매주 · 월 ~ 금");
  expect(periodRepeatName("day", sprint, at(11, 13, 18))).toBe("매일");
  expect(periodRepeatName("week", task(null, at(11, 13, 18)), at(11, 13, 18))).toBe("매주 금요일");
  expect(periodChipText(at(11, 20), end(11, 23), "12", NOW)).toBe("11.20 ~ 11.23");
  expect(periodChipText(at(11, 20, 14), at(11, 20, 17), "12", NOW)).toBe("11.20 오후 2시 ~ 오후 5시");
  expect(periodChipText(at(11, 20, 14), at(11, 21, 9), "12", NOW)).toBe("11.20 오후 2시 ~ 11.21 오전 9시");
  // Another year on either end: both ends have it (#111).
  const y = (year, m, d, h = 0) => new Date(year, m - 1, d, h).getTime();
  expect(periodChipText(y(2026, 12, 30), y(2027, 1, 2, 18), "12", NOW)).toBe("26.12.30 ~ 27.01.02 오후 6시");
  expect(periodChipText(y(2027, 3, 1, 9), y(2027, 3, 1, 12), "12", NOW, { dateSep: "/", yearDigits: 4, datePad: false })).toBe("2027/3/1 오전 9시 ~ 오후 12시");
});

describe("dates of a row (#111)", () => {
  const y = (year, m, d, h = 0, min = 0) => new Date(year, m - 1, d, h, min).getTime();
  const day = (offset, h, min = 0) => at(11, 10 + offset, h, min); // from NOW (Tue 11/10)

  test("a period inside one day says its day like a due row", () => {
    expect(periodText(task(day(0, 19), day(0, 21)), "12", NOW)).toBe("오후 7시 ~ 9시");
    expect(periodText(task(day(1, 19), day(1, 21)), "12", NOW)).toBe("내일 오후 7시 ~ 9시");
    expect(periodText(task(day(-1, 19), day(-1, 21)), "12", NOW)).toBe("어제 오후 7시 ~ 9시");
    expect(periodText(task(day(2, 19), day(2, 21)), "12", NOW)).toBe("목 오후 7시 ~ 9시");
    expect(periodText(task(day(6, 19), day(6, 21)), "24", NOW)).toBe("월 19:00 ~ 21:00");
    expect(periodText(task(day(7, 19), day(7, 21)), "12", NOW)).toBe("11.17 오후 7시 ~ 9시");
    expect(periodText(task(day(14, 19), end(11, 24)), "12", NOW)).toBe("11.24 오후 7시 ~ 하루 끝");
    // Another year: the year is in the date.
    expect(periodText(task(y(2027, 12, 20, 10, 30), y(2027, 12, 20, 12, 30)), "12", NOW)).toBe("27.12.20 오전 10:30 ~ 오후 12:30");
    // A one-day period whose start has no time: its date.
    expect(periodText(task(day(7, 0), day(7, 18)), "12", NOW)).toBe("11.17");
  });

  test("several days: numeric dates, the year on both ends when either is not this year", () => {
    expect(periodText(task(y(2026, 11, 2), y(2027, 2, 28, 23, 59)), "12", NOW)).toBe("26.11.02 ~ 27.02.28");
    expect(periodText(task(y(2027, 12, 30), y(2028, 1, 2, 23, 59)), "12", NOW)).toBe("27.12.30 ~ 28.01.02");
    expect(periodText(task(y(2028, 3, 1), y(2028, 3, 5, 23, 59)), "12", NOW, { yearDigits: 4 })).toBe("2028.03.01 ~ 2028.03.05");
    expect(periodText(task(y(2026, 12, 3), y(2026, 12, 7, 23, 59)), "12", NOW, { dateSep: "/", datePad: false })).toBe("12/3 ~ 12/7");
  });

  test("the timeline's block head is the clocks only", () => {
    expect(periodClockText(task(day(7, 19), day(7, 21)), "12", NOW)).toBe("오후 7시 ~ 9시");
    expect(periodClockText(task(day(1, 19), end(11, 11)), "12", NOW)).toBe("오후 7시 ~ 하루 끝");
    expect(periodClockText(task(at(11, 9), end(11, 12)), "12", NOW)).toBe("11.09 ~ 11.12");
  });

  test("a start at 0:00 (stored .001) is a time; its length counts from the minute", () => {
    const zero = at(11, 12, 0) + 1;
    expect(periodText(task(zero, at(11, 12, 3)), "12", NOW)).toBe("목 오전 12시 ~ 3시");
    expect(periodText(task(at(11, 12, 0), at(11, 12, 3)), "12", NOW)).toBe("11.12");
    expect(startDetailText(zero)).toBe("2026.11.12 오전 12:00");
    expect(startDetailText(at(11, 12, 0))).toBe("2026.11.12 · 하루 시작");
    expect(periodProgress(task(zero, at(11, 12, 3)), NOW)).toMatchObject({ label: "1일 10시간 뒤 시작" });
    expect(periodProgress(task(at(11, 10, 0) + 1, at(11, 10, 3)), at(11, 10, 1, 30)).label).toBe("50% · 1시간 30분 뒤 종료");
  });
});
