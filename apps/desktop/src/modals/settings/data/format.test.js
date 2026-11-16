import { relativeTime, shortDate } from "./format";

// The settings' dates follow the app's year rule (#111): no year this year, the year otherwise.
test("shortDate and relativeTime add the year only in another year", () => {
  const now = new Date(2026, 10, 16, 13, 20).getTime();
  expect(shortDate(new Date(2026, 10, 9).getTime(), now)).toBe("11월 9일");
  expect(shortDate(new Date(2025, 11, 30).getTime(), now)).toBe("2025년 12월 30일");
  expect(relativeTime(new Date(2026, 10, 2).getTime(), now)).toBe("11월 2일");
  expect(relativeTime(new Date(2025, 0, 5).getTime(), now)).toBe("2025년 1월 5일");
  expect(relativeTime(now - 5 * 60000, now)).toBe("5분 전");
});
