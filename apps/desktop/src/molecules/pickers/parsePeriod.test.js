import parseDue, { parsePeriod } from "./parseDue";

// Tue 2026-11-10 13:20, the period mock's now (#109).
const NOW = new Date(2026, 10, 10, 13, 20).getTime();
const fmt = (ms) => {
  const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
// "2026-11-20 00:00:00 ~ 2026-11-23 23:59:59"; false/null as they come.
const read = (text, now = NOW, ws = 0) => {
  const r = parsePeriod(text, now, ws);
  return r ? `${fmt(r.start)} ~ ${fmt(r.end)}` : r;
};

describe("parsePeriod", () => {
  test("an empty text is null; a single date or anything else is false", () => {
    expect(parsePeriod("", NOW)).toBeNull();
    expect(parsePeriod("  ", NOW)).toBeNull();
    expect(parsePeriod(null, NOW)).toBeNull();
    for (const text of ["11/20", "11-20", "2026-11-20", "내일 3시", "언젠가~내일", "11/20~", "~11/20", "11/20~11/23~11/25", "내일부터", "abc"])
      expect(parsePeriod(text, NOW)).toBe(false);
  });

  test.each([
    ["11/20~11/23", "2026-11-20 00:00:00 ~ 2026-11-23 23:59:59"],
    ["11/20 ~ 11/23", "2026-11-20 00:00:00 ~ 2026-11-23 23:59:59"],
    ["11/20~23", "2026-11-20 00:00:00 ~ 2026-11-23 23:59:59"],
    ["11/20~23일", "2026-11-20 00:00:00 ~ 2026-11-23 23:59:59"],
    ["11/20-11/23", "2026-11-20 00:00:00 ~ 2026-11-23 23:59:59"],
    ["11월 20일부터 11월 23일까지", "2026-11-20 00:00:00 ~ 2026-11-23 23:59:59"],
    ["2026-11-20~2026-11-23", "2026-11-20 00:00:00 ~ 2026-11-23 23:59:59"],
    ["11/20 15:00~17:00", "2026-11-20 15:00:00 ~ 2026-11-20 17:00:00"],
    ["11/20 오후 3시 ~ 11/21 오전 10시", "2026-11-20 15:00:00 ~ 2026-11-21 10:00:00"],
    ["11/20 15:00~11/22", "2026-11-20 15:00:00 ~ 2026-11-22 23:59:59"],
    ["11/20~11/22 18:00", "2026-11-20 00:00:00 ~ 2026-11-22 18:00:00"],
    // A time alone without 오전/오후 that would end before the start is PM.
    ["오후 2시~5시", "2026-11-10 14:00:00 ~ 2026-11-10 17:00:00"],
    ["내일 3시~5시", "2026-11-11 03:00:00 ~ 2026-11-11 05:00:00"],
    ["내일 오전 9시부터 오후 6시까지", "2026-11-11 09:00:00 ~ 2026-11-11 18:00:00"],
    ["내일부터 금요일까지", "2026-11-11 00:00:00 ~ 2026-11-13 23:59:59"],
    ["오늘부터 3일 뒤까지", "2026-11-10 00:00:00 ~ 2026-11-13 23:59:59"],
    ["오늘~모레", "2026-11-10 00:00:00 ~ 2026-11-12 23:59:59"],
    ["다음 주 월요일부터 금요일까지", "2026-11-16 00:00:00 ~ 2026-11-20 23:59:59"],
    ["내일부터 수요일까지", "2026-11-11 00:00:00 ~ 2026-11-11 23:59:59"],
    ["금요일부터 다음 주 화요일", "2026-11-13 00:00:00 ~ 2026-11-17 23:59:59"],
    // A day of the month before the start's day is next month's.
    ["11/28~3", "2026-11-28 00:00:00 ~ 2026-12-3 23:59:59"],
  ])("%s → %s", (text, period) => expect(read(text)).toBe(period));

  test("date-only sides start at 00:00 and end at 23:59:59, and say they have no time", () => {
    expect(parsePeriod("11/20~11/23", NOW)).toMatchObject({ startMinutes: null, endMinutes: null });
    expect(parsePeriod("11/20 15:00~17:00", NOW)).toMatchObject({ startMinutes: 900, endMinutes: 1020 });
    expect(parsePeriod("11/20~11/22 18:00", NOW)).toMatchObject({ startMinutes: null, endMinutes: 1080 });
  });

  test("a start after (or at) the end is refused", () => {
    for (const text of ["11/23~11/20", "11/20 17:00~15:00", "11/20 15:00~15:00", "11/20 오후 5시~오후 3시", "모레부터 내일까지", "11/20 15:00~11/19"])
      expect(parsePeriod(text, NOW)).toBe(false);
  });

  test("the year wraps: an end in an earlier month is next year's", () => {
    expect(read("12/30~1/2")).toBe("2026-12-30 00:00:00 ~ 2027-1-2 23:59:59");
    expect(read("12/31 22:00~1/1 02:00")).toBe("2026-12-31 22:00:00 ~ 2027-1-1 02:00:00");
    // Typed while it runs (12/31): it stays this year's.
    expect(read("12/30~1/2", new Date(2026, 11, 31, 9).getTime())).toBe("2026-12-30 00:00:00 ~ 2027-1-2 23:59:59");
    // With a year, as written.
    expect(read("2027-1-5~2027-1-8")).toBe("2027-1-5 00:00:00 ~ 2027-1-8 23:59:59");
  });

  test("a started period stays this year; one already over is next year's, as single dates are", () => {
    expect(read("11/5~11/12")).toBe("2026-11-5 00:00:00 ~ 2026-11-12 23:59:59");
    expect(read("11/1~11/3")).toBe("2027-11-1 00:00:00 ~ 2027-11-3 23:59:59");
    expect(read("5일~12일")).toBe("2026-11-5 00:00:00 ~ 2026-11-12 23:59:59");
  });

  test("the week start is used for 다음 주", () => {
    // Monday first: 다음 주 is 11/16 to 11/22 either way; 이번 주 일요일 differs.
    expect(read("이번 주 월요일~이번 주 일요일", NOW, 1)).toBe("2026-11-9 00:00:00 ~ 2026-11-15 23:59:59");
    expect(read("이번 주 일요일~이번 주 토요일", NOW, 0)).toBe("2026-11-8 00:00:00 ~ 2026-11-14 23:59:59");
  });

  test("single dates read by parseDue are unchanged", () => {
    expect(parseDue("11/20", NOW)).toEqual({ day: new Date(2026, 10, 20), minutes: null });
    expect(parseDue("11/1", NOW)).toEqual({ day: new Date(2027, 10, 1), minutes: null });
    expect(parseDue("내일 3시", NOW)).toEqual({ day: new Date(2026, 10, 11), minutes: 180 });
    expect(parseDue("금요일", NOW)).toEqual({ day: new Date(2026, 10, 13), minutes: null });
    expect(parseDue("23", NOW)).toBe(false);
  });
});
