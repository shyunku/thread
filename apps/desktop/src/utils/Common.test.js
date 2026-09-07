import { fromRelativeTime } from "./Common";

describe("compact remaining time", () => {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  test.each([
    [hour + 35 * minute, "1시간"],
    [2 * hour + 59 * minute, "2시간"],
    [day + 23 * hour, "1일"],
    [90 * day, "3개월"],
    [59 * minute + 59 * 1000, "59분"],
    [59 * 1000, "59초"],
    [999, "0초"],
    [0, "0초"],
  ])("floors %i ms to one unit", (milliseconds, expected) => {
    expect(fromRelativeTime(milliseconds, { showLayerCount: 1, showMillisec: false })).toBe(expected);
  });

  test("keeps multi-unit detail formatting unchanged", () => {
    expect(fromRelativeTime(hour + 35 * minute, { showLayerCount: 2 })).toBe("1시간 35분");
  });
});
