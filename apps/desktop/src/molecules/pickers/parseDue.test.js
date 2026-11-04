import parseDue from "./parseDue";

// Wed 2026-11-04 14:20, like the mock.
const NOW = new Date(2026, 10, 4, 14, 20).getTime();
const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const hm = (m) => (m === null ? null : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`);
// "2026-11-5 15:00", or "2026-11-5" without a time; false/null as they come.
const read = (text, now = NOW, ws = 0) => {
  const r = parseDue(text, now, ws);
  if (!r) return r;
  return r.minutes === null ? ymd(r.day) : `${ymd(r.day)} ${hm(r.minutes)}`;
};

describe("empty and not understood", () => {
  test("an empty text is null", () => {
    expect(parseDue("", NOW)).toBeNull();
    expect(parseDue("   ", NOW)).toBeNull();
    expect(parseDue(null, NOW)).toBeNull();
  });

  test.each(["언젠가", "내일 회의", "13/40", "26.2.30", "2월 30일", "11월", "25:00", "오늘 3시 70분", "abc", "일"])("%s is not understood", (text) => {
    expect(parseDue(text, NOW)).toBe(false);
  });
});

describe("days", () => {
  test.each([
    ["오늘", "2026-11-4"],
    ["내일", "2026-11-5"],
    ["모레", "2026-11-6"],
    ["내일모레", "2026-11-6"],
    ["글피", "2026-11-7"],
    ["3일 뒤", "2026-11-7"],
    ["3일후", "2026-11-7"],
    ["이틀 뒤", "2026-11-6"],
    ["일주일 뒤", "2026-11-11"],
    ["2주 뒤", "2026-11-18"],
    ["한 달 뒤", "2026-12-4"],
    ["3개월 뒤", "2027-2-4"],
  ])("%s → %s", (text, day) => expect(read(text)).toBe(day));

  test("a day comes at midnight with no time", () => {
    const r = parseDue("내일", NOW);
    expect(r.minutes).toBeNull();
    expect([r.day.getHours(), r.day.getMinutes(), r.day.getSeconds(), r.day.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });

  test("까지, 에 and 쯤 at the end are left out", () => {
    expect(read("내일까지")).toBe("2026-11-5");
    expect(read("금요일에")).toBe("2026-11-6");
    expect(read("3시쯤")).toBe("2026-11-5 3:00");
  });
});

describe("dates", () => {
  test.each([
    ["2026-11-30", "2026-11-30"],
    ["2026.11.30", "2026-11-30"],
    ["2026/11/30", "2026-11-30"],
    ["2026년 11월 30일", "2026-11-30"],
    ["26.11.30", "2026-11-30"],
    ["26년 11월 30일", "2026-11-30"],
    ["27-1-5", "2027-1-5"],
    ["11/20", "2026-11-20"],
    ["11.30", "2026-11-30"],
    ["11.30.", "2026-11-30"],
    ["11월 20일", "2026-11-20"],
    ["11월20일", "2026-11-20"],
  ])("%s → %s", (text, day) => expect(read(text)).toBe(day));

  test("a month and day already past, without a year, is next year's", () => {
    expect(read("1/5")).toBe("2027-1-5");
    expect(read("11월 3일")).toBe("2027-11-3");
    expect(read("11월 4일")).toBe("2026-11-4"); // today is not past
  });

  test("a past date with a year stays as written", () => {
    expect(read("2026-1-5")).toBe("2026-1-5");
    expect(read("25.12.25")).toBe("2025-12-25");
  });

  test("a day of the month: this month's, or next month's once past", () => {
    expect(read("25일")).toBe("2026-11-25");
    expect(read("4일")).toBe("2026-11-4");
    expect(read("3일")).toBe("2026-12-3");
    expect(read("31일")).toBe("2026-12-31"); // November has no 31st
  });

  test("이번 달 · 다음 달 and the end of the month", () => {
    expect(read("다음 달 1일")).toBe("2026-12-1");
    expect(read("다음달 15일")).toBe("2026-12-15");
    expect(read("이번 달 20일")).toBe("2026-11-20");
    expect(read("이번 달 말")).toBe("2026-11-30");
    expect(read("월말")).toBe("2026-11-30");
    expect(read("다음 달 말")).toBe("2026-12-31");
    expect(read("다음 달 31일")).toBe("2026-12-31");
    expect(parseDue("다음 달 32일", NOW)).toBe(false);
  });
});

describe("weekdays and weeks", () => {
  test("a weekday alone is the next one after today; today's weekday is next week's", () => {
    expect(read("금요일")).toBe("2026-11-6");
    expect(read("금")).toBe("2026-11-6");
    expect(read("월요일")).toBe("2026-11-9");
    expect(read("수요일")).toBe("2026-11-11");
    expect(read("일요일")).toBe("2026-11-8");
    expect(read("주말")).toBe("2026-11-7");
  });

  test("이번 주 · 다음 주 follow the week start", () => {
    // Sunday start: this week is 11/1–11/7; Monday start: 11/2–11/8.
    expect(read("다음 주 수요일", NOW, 0)).toBe("2026-11-11");
    expect(read("다음 주 수요일", NOW, 1)).toBe("2026-11-11");
    expect(read("이번 주 일요일", NOW, 0)).toBe("2026-11-1");
    expect(read("이번 주 일요일", NOW, 1)).toBe("2026-11-8");
    expect(read("다음 주 일요일", NOW, 0)).toBe("2026-11-8");
    expect(read("다음 주 일요일", NOW, 1)).toBe("2026-11-15");
    expect(read("이번 주 토요일")).toBe("2026-11-7");
    expect(read("다다음 주 월요일", NOW, 1)).toBe("2026-11-16");
  });

  test("다음 주 alone is that week's Monday", () => {
    expect(read("다음 주", NOW, 0)).toBe("2026-11-9");
    expect(read("다음 주", NOW, 1)).toBe("2026-11-9");
    // On a Sunday the next week differs by week start.
    const SUN = new Date(2026, 10, 8, 10, 0).getTime();
    expect(read("다음 주", SUN, 0)).toBe("2026-11-16");
    expect(read("다음 주", SUN, 1)).toBe("2026-11-9");
  });

  test("a weekday with a time", () => {
    expect(read("다음 주 수요일 오후 2시")).toBe("2026-11-11 14:00");
    expect(read("금요일 3시")).toBe("2026-11-6 3:00");
  });
});

describe("times", () => {
  test("hours without 오전/오후 are taken as written", () => {
    expect(read("내일 3시")).toBe("2026-11-5 3:00");
    expect(read("내일 15시")).toBe("2026-11-5 15:00");
    expect(read("내일 0시")).toBe("2026-11-5 0:00");
    expect(read("내일 12시")).toBe("2026-11-5 12:00");
    expect(read("내일 6시")).toBe("2026-11-5 6:00");
  });

  test("오전 · 오후 and other day parts", () => {
    expect(read("내일 오후 3시")).toBe("2026-11-5 15:00");
    expect(read("내일 오전 9시 30분")).toBe("2026-11-5 9:30");
    expect(read("내일 오후 12시")).toBe("2026-11-5 12:00");
    expect(read("내일 오전 12시")).toBe("2026-11-5 0:00");
    expect(read("내일 저녁 7시 반")).toBe("2026-11-5 19:30");
    expect(read("내일 밤 10시")).toBe("2026-11-5 22:00");
    expect(read("내일 밤 12시")).toBe("2026-11-5 23:59");
    expect(read("내일 새벽 2시")).toBe("2026-11-5 2:00");
    expect(read("내일 아침 8시")).toBe("2026-11-5 8:00");
    expect(read("내일 낮 2시")).toBe("2026-11-5 14:00");
    expect(read("내일 낮 11시")).toBe("2026-11-5 11:00");
    expect(read("내일 오후 15시")).toBe("2026-11-5 15:00");
    expect(read("내일 오후 3")).toBe("2026-11-5 15:00");
    expect(parseDue("내일 오전 15시", NOW)).toBe(false);
  });

  test("clock forms", () => {
    expect(read("11월 20일 14:30")).toBe("2026-11-20 14:30");
    expect(read("2026-11-30 9:05")).toBe("2026-11-30 9:05");
    expect(read("내일 오후 3:30")).toBe("2026-11-5 15:30");
    expect(read("내일 3시 15분")).toBe("2026-11-5 3:15");
    expect(read("내일 정오")).toBe("2026-11-5 12:00");
    expect(read("내일 3시까지")).toBe("2026-11-5 3:00");
  });

  test("a bare number after a day is the hour", () => {
    expect(read("내일 3")).toBe("2026-11-5 3:00");
    expect(read("금요일 15")).toBe("2026-11-6 15:00");
    expect(read("11/20 9")).toBe("2026-11-20 9:00");
    expect(parseDue("내일 30", NOW)).toBe(false);
  });

  test("a time alone is today's, or tomorrow's once it has passed", () => {
    expect(read("3시")).toBe("2026-11-5 3:00");
    expect(read("15시")).toBe("2026-11-4 15:00");
    expect(read("14:20")).toBe("2026-11-5 14:20"); // now is not later than now
    expect(read("14:21")).toBe("2026-11-4 14:21");
    expect(read("오후 2시")).toBe("2026-11-5 14:00");
    expect(read("저녁 7시 반")).toBe("2026-11-4 19:30");
    expect(read("정오")).toBe("2026-11-5 12:00");
  });

  test("hours and minutes from now", () => {
    expect(read("2시간 뒤")).toBe("2026-11-4 16:20");
    expect(read("30분 후")).toBe("2026-11-4 14:50");
    expect(read("10시간 뒤")).toBe("2026-11-5 0:20");
  });
});

describe("other days", () => {
  test("now near the end of a year and a month", () => {
    const DEC31 = new Date(2026, 11, 31, 9, 0).getTime();
    expect(read("내일", DEC31)).toBe("2027-1-1");
    expect(read("1/2", DEC31)).toBe("2027-1-2");
    expect(read("12/31", DEC31)).toBe("2026-12-31");
    expect(read("다음 달 1일", DEC31)).toBe("2027-1-1");
    expect(read("한 달 뒤", new Date(2026, 0, 31).getTime())).toBe("2026-2-28");
  });

  test("a Date works as now", () => {
    expect(read("내일", new Date(2026, 10, 4, 14, 20))).toBe("2026-11-5");
  });
});
