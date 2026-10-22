import { DATE_GROUP_IDS, dateGroupOf, dayLabel, daysLeftInWeek, monthGridStart, quickDays, startOfWeek, weekdayOrder } from "./dateGroups";

// October 2026: the 21st is a Wednesday, the 24th a Saturday, the 25th a Sunday.
const day = (date, h = 12, m = 0) => new Date(2026, 9, date, h, m).valueOf();
const ymd = (value) => { const d = new Date(value); return `${d.getMonth() + 1}/${d.getDate()}`; };

test("weekday order and week starts follow 주 시작 요일", () => {
  expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  expect(ymd(startOfWeek(day(21), 0))).toBe("10/18");
  expect(ymd(startOfWeek(day(21), 1))).toBe("10/19");
  expect(ymd(startOfWeek(day(25), 0))).toBe("10/25"); // Sunday starts its own week
  expect(ymd(startOfWeek(day(25), 1))).toBe("10/19"); // and ends a Monday week
  expect(new Date(startOfWeek(day(21, 23, 59), 0)).getHours()).toBe(0);
  // October 1st 2026 is a Thursday.
  expect(ymd(monthGridStart(2026, 9, 0))).toBe("9/27");
  expect(ymd(monthGridStart(2026, 9, 1))).toBe("9/28");
  // A month starting on the week start begins on its own 1st (November 1st is a Sunday).
  expect(ymd(monthGridStart(2026, 10, 0))).toBe("11/1");
  expect(ymd(monthGridStart(2026, 10, 1))).toBe("10/26");
});

test("days left in this calendar week", () => {
  expect(daysLeftInWeek(day(21), 0)).toBe(3); // Wed → Sat
  expect(daysLeftInWeek(day(21), 1)).toBe(4); // Wed → Sun
  expect(daysLeftInWeek(day(24), 0)).toBe(0); // Saturday ends a Sunday week
  expect(daysLeftInWeek(day(24), 1)).toBe(1);
  expect(daysLeftInWeek(day(25), 0)).toBe(6); // Sunday starts one
  expect(daysLeftInWeek(day(25), 1)).toBe(0);
});

describe("date groups", () => {
  const groups = (now, weekStart, from = -2, to = 16) => {
    const out = {};
    for (let n = from; n <= to; n++) {
      const due = new Date(now); due.setDate(due.getDate() + n); due.setHours(18, 0, 0, 0);
      (out[dateGroupOf(due.valueOf(), now, weekStart)] ||= []).push(n);
    }
    return out;
  };

  test("ids are in display order and include 완료됨", () => {
    expect(DATE_GROUP_IDS).toEqual(["over", "today", "tomorrow", "week", "next", "later", "none", "done"]);
  });

  test("no due is 기한 없음; earlier today is still 오늘", () => {
    expect(dateGroupOf(null, day(21))).toBe("none");
    expect(dateGroupOf(undefined, day(21))).toBe("none");
    expect(dateGroupOf(day(21, 0, 1), day(21, 23))).toBe("today");
    expect(dateGroupOf(day(20, 23, 59), day(21, 0, 1))).toBe("over");
  });

  test("Wednesday, Sunday start: 이번 주 runs to Saturday, 다음 주 the next 7 days", () => {
    expect(groups(day(21), 0)).toEqual({ over: [-2, -1], today: [0], tomorrow: [1], week: [2, 3], next: [4, 5, 6, 7, 8, 9, 10], later: [11, 12, 13, 14, 15, 16] });
  });

  test("Wednesday, Monday start: 이번 주 runs to Sunday", () => {
    expect(groups(day(21), 1)).toEqual({ over: [-2, -1], today: [0], tomorrow: [1], week: [2, 3, 4], next: [5, 6, 7, 8, 9, 10, 11], later: [12, 13, 14, 15, 16] });
  });

  test("on the last day of the week there is no 이번 주; tomorrow stays 내일", () => {
    expect(groups(day(24), 0)).toEqual({ over: [-2, -1], today: [0], tomorrow: [1], next: [2, 3, 4, 5, 6, 7], later: [8, 9, 10, 11, 12, 13, 14, 15, 16] });
    expect(groups(day(25), 1)).toEqual({ over: [-2, -1], today: [0], tomorrow: [1], next: [2, 3, 4, 5, 6, 7], later: [8, 9, 10, 11, 12, 13, 14, 15, 16] });
  });

  test("one day before the end: 이번 주 is empty and 다음 주 starts after tomorrow", () => {
    expect(groups(day(24), 1)).toEqual({ over: [-2, -1], today: [0], tomorrow: [1], next: [2, 3, 4, 5, 6, 7, 8], later: [9, 10, 11, 12, 13, 14, 15, 16] });
  });

  test("Sunday with a Sunday start has the whole week ahead", () => {
    expect(groups(day(25), 0)).toEqual({ over: [-2, -1], today: [0], tomorrow: [1], week: [2, 3, 4, 5, 6], next: [7, 8, 9, 10, 11, 12, 13], later: [14, 15, 16] });
  });
});

describe("date picker quick days", () => {
  const summary = (now, weekStart) => quickDays(now, weekStart).map((q) => `${q.label} ${ymd(q.date)}`);

  test("Wednesday shows this Saturday and next Monday", () => {
    expect(summary(day(21), 0)).toEqual(["오늘 10/21", "내일 10/22", "이번 주 토요일 10/24", "다음 주 월요일 10/26"]);
    expect(summary(day(21), 1)).toEqual(["오늘 10/21", "내일 10/22", "이번 주 토요일 10/24", "다음 주 월요일 10/26"]);
  });

  test("Saturday is left out when it is today or tomorrow", () => {
    expect(summary(day(24), 0)).toEqual(["오늘 10/24", "내일 10/25", "다음 주 월요일 10/26"]);
    expect(summary(day(23), 0)).toEqual(["오늘 10/23", "내일 10/24", "다음 주 월요일 10/26"]);
    expect(summary(day(24), 1)).toEqual(["오늘 10/24", "내일 10/25", "다음 주 월요일 10/26"]);
  });

  test("Sunday: with a Monday start this week's Saturday has passed; with a Sunday start it is ahead", () => {
    // 다음 주 월요일 would be tomorrow here, so it is left out like a Saturday that is tomorrow.
    expect(summary(day(25), 1)).toEqual(["오늘 10/25", "내일 10/26"]);
    expect(summary(day(25), 0)).toEqual(["오늘 10/25", "내일 10/26", "이번 주 토요일 10/31", "다음 주 월요일 11/2"]);
  });

  test("Monday: next Monday is a week away", () => {
    expect(summary(day(19), 0)).toEqual(["오늘 10/19", "내일 10/20", "이번 주 토요일 10/24", "다음 주 월요일 10/26"]);
    expect(summary(day(19), 1)).toEqual(["오늘 10/19", "내일 10/20", "이번 주 토요일 10/24", "다음 주 월요일 10/26"]);
  });

  test("each day has an id, a midnight date and a tooltip with the weekday", () => {
    const [today, , saturday] = quickDays(day(21, 15, 30), 0);
    expect(today).toMatchObject({ id: "today", offset: 0, tip: "10월 21일 (수)" });
    expect(new Date(today.date).getHours()).toBe(0);
    expect(saturday).toMatchObject({ id: "saturday", offset: 3, tip: "10월 24일 (토)" });
    expect(dayLabel(day(25))).toBe("10월 25일 (일)");
  });
});
