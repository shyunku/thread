import { endOfDay, nextRepeatDue, normalRepeat, repeatName, repeatOptions, repeatShortName } from "./repeatRule";
// The shared recurrence code the app runs when a repeating task is completed.
const { nextDue } = require("../../../../packages/e2ee/src/recurrence");

const at = (m, d, h = 23, min = 59, s = 59, y = 2026) => new Date(y, m - 1, d, h, min, s).getTime();
const NOW = at(10, 21, 14, 30, 0); // Wed 2026-10-21 14:30

test("names follow the base date", () => {
  const base = at(10, 21, 17, 30, 0);
  expect(repeatName(null, base)).toBe("안 함");
  expect(repeatName("", base)).toBe("안 함");
  expect(repeatName("day", base)).toBe("매일");
  expect(repeatName("week", base)).toBe("매주 수요일");
  expect(repeatName("month", base)).toBe("매월 21일");
  expect(repeatName("year", base)).toBe("매년 10월 21일");
  expect(repeatShortName("week")).toBe("매주");
  expect(repeatShortName("")).toBe("");
  expect(normalRepeat("hour")).toBe(null);
});

test("picker rows with the next date, year shown when it changes", () => {
  const rows = repeatOptions({ base: at(10, 21, 17, 30, 0), value: "week", now: NOW });
  expect(rows.map((r) => [r.period, r.name, r.sub, r.on])).toEqual([
    [null, "안 함", "한 번만", false],
    ["day", "매일", "다음: 10월 22일 (목)", false],
    ["week", "매주 수요일", "다음: 10월 28일 (수)", true],
    ["month", "매월 21일", "다음: 11월 21일 (토)", false],
    ["year", "매년 10월 21일", "다음: 2027년 10월 21일 (목)", false],
  ]);
});

test("31 October monthly comes next on 1 December, as recurrence.js computes it", () => {
  const base = at(10, 31);
  const month = repeatOptions({ base, now: NOW }).find((r) => r.period === "month");
  expect(month.next).toBe(nextDue(base, base, "month", NOW));
  expect(month.sub).toBe("다음: 12월 1일 (화)");
});

test("without a due date the rule starts at today's end of day", () => {
  const rows = repeatOptions({ base: null, now: NOW });
  expect(rows[0].on).toBe(true);
  expect(rows.find((r) => r.period === "week").name).toBe("매주 수요일");
  expect(rows.find((r) => r.period === "day").next).toBe(at(10, 22));
  expect(endOfDay(NOW)).toBe(at(10, 21));
});

test("an overdue due steps past now, like completing it now", () => {
  const base = at(10, 14, 17, 30, 0);
  const rows = repeatOptions({ base, now: NOW });
  expect(rows.find((r) => r.period === "week").sub).toBe("다음: 10월 21일 (수)");
  expect(rows.find((r) => r.period === "day").sub).toBe("다음: 10월 21일 (수)");
});

test("the current period keeps its own anchor, for the name and the next date", () => {
  // Anchored on 31 October, now due on 1 December (the month-end overflow): the rule is still
  // "매월 31일" and, as recurrence.js steps it (31 Oct, 1 Dec, 1 Jan), the next is 1 January.
  const rows = repeatOptions({ base: at(12, 1), value: "month", repeatStartAt: at(10, 31), now: NOW });
  const month = rows.find((r) => r.period === "month");
  expect(month.next).toBe(nextDue(at(10, 31), at(12, 1), "month", NOW));
  expect(month.next).toBe(at(1, 1, 23, 59, 59, 2027));
  expect(month.name).toBe("매월 31일");
  // The other periods would start from the due date.
  expect(rows.find((r) => r.period === "week").name).toBe("매주 화요일");
});

test("Date objects (renderer state) work like ms; 0 means none", () => {
  const base = new Date(at(10, 21, 17, 30, 0));
  const rows = repeatOptions({ base, value: "week", repeatStartAt: new Date(at(10, 14, 17, 30, 0)), now: new Date(NOW) });
  expect(rows.find((r) => r.period === "week").sub).toBe("다음: 10월 28일 (수)");
  expect(rows.find((r) => r.period === "day").sub).toBe("다음: 10월 22일 (목)");
  expect(nextRepeatDue(new Date(at(10, 21)), new Date(at(10, 21)), "day", NOW)).toBe(at(10, 22));
  // A stored 0 is no due date and no anchor: the rule starts from today's end of day.
  const none = repeatOptions({ base: 0, value: "day", repeatStartAt: 0, now: NOW });
  expect(none.find((r) => r.period === "day").next).toBe(at(10, 22));
  expect(nextRepeatDue(0, NOW, "day", NOW)).toBe(null);
});

test("next dates match recurrence.js nextDue", () => {
  const starts = [at(1, 31), at(2, 28), at(2, 29, 23, 59, 59, 2028), at(3, 31, 0, 30, 0), at(10, 31), at(12, 31, 9, 0, 0), at(10, 21, 17, 30, 0)];
  for (const start of starts) {
    for (const period of ["day", "week", "month", "year"]) {
      for (const now of [NOW, start + 3 * 864e5, start + 400 * 864e5]) {
        expect(nextRepeatDue(start, start, period, now)).toBe(nextDue(start, start, period, now));
      }
    }
  }
  expect(nextRepeatDue(NaN, NOW, "day", NOW)).toBe(null);
  expect(nextRepeatDue(NOW, NOW, "", NOW)).toBe(null);
});
