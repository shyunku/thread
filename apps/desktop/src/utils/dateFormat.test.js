import { dateExamples, dateFormatOptions, isOtherYear, longDate, numericDate, rangeHasYear, shortDate, shortRange, shortRangeText } from "./dateFormat";

const NOW = new Date(2026, 10, 16, 13, 20).getTime();
const d = (y, m, day) => new Date(y, m - 1, day, 12).getTime();

test("options fall back to 28.03.01: dot, two digits, zero padding", () => {
  expect(dateFormatOptions()).toEqual({ dateSep: ".", yearDigits: 2, datePad: true });
  expect(dateFormatOptions({ dateSep: "-", yearDigits: 3, datePad: "no" })).toEqual({ dateSep: ".", yearDigits: 2, datePad: true });
  expect(dateFormatOptions({ dateSep: "/", yearDigits: 4, datePad: false })).toEqual({ dateSep: "/", yearDigits: 4, datePad: false });
});

test("separator, digits and padding", () => {
  expect(numericDate(d(2028, 3, 1), true)).toBe("28.03.01");
  expect(numericDate(d(2028, 3, 1), true, { dateSep: "/" })).toBe("28/03/01");
  expect(numericDate(d(2028, 3, 1), true, { yearDigits: 4 })).toBe("2028.03.01");
  expect(numericDate(d(2028, 3, 1), true, { datePad: false })).toBe("28.3.1");
  expect(numericDate(d(2028, 3, 1), true, { dateSep: "/", yearDigits: 4, datePad: false })).toBe("2028/3/1");
  expect(numericDate(d(2005, 3, 1), true, { datePad: false })).toBe("05.3.1");
  expect(numericDate(d(2028, 11, 18), false)).toBe("11.18");
  expect(numericDate(d(2028, 11, 18), false, { datePad: false, dateSep: "/" })).toBe("11/18");
});

test("this year has no year, another year has it", () => {
  expect(isOtherYear(d(2026, 1, 1), NOW)).toBe(false);
  expect(isOtherYear(d(2027, 1, 1), NOW)).toBe(true);
  expect(shortDate(d(2026, 11, 18), NOW)).toBe("11.18");
  expect(shortDate(d(2025, 12, 31), NOW)).toBe("25.12.31");
  expect(shortDate(d(2031, 7, 15), NOW, { yearDigits: 4 })).toBe("2031.07.15");
  expect(longDate(d(2026, 3, 1), NOW)).toBe("3월 1일");
  expect(longDate(d(2028, 3, 1), NOW)).toBe("2028년 3월 1일");
});

test("a period: the year on both ends when either is not this year", () => {
  expect(rangeHasYear(d(2026, 12, 3), d(2026, 12, 7), NOW)).toBe(false);
  expect(shortRange(d(2026, 12, 3), d(2026, 12, 7), NOW)).toEqual(["12.03", "12.07"]);
  expect(shortRangeText(d(2026, 11, 2), d(2027, 2, 28), NOW)).toBe("26.11.02 ~ 27.02.28");
  expect(shortRangeText(d(2025, 12, 30), d(2026, 1, 2), NOW)).toBe("25.12.30 ~ 26.01.02");
  expect(shortRangeText(d(2028, 3, 1), d(2028, 3, 5), NOW, { yearDigits: 4 })).toBe("2028.03.01 ~ 2028.03.05");
});

test("settings examples, as they would be with a change", () => {
  expect(dateExamples({}, NOW)).toBe("11.18 · 28.03.01 · 26.11.02 ~ 27.02.28");
  expect(dateExamples({}, NOW, { dateSep: "/" })).toBe("11/18 · 28/03/01 · 26/11/02 ~ 27/02/28");
  expect(dateExamples({ dateSep: "/" }, NOW, { yearDigits: 4 })).toBe("11/18 · 2028/03/01 · 2026/11/02 ~ 2027/02/28");
  expect(dateExamples({}, NOW, { datePad: false })).toBe("11.18 · 28.3.1 · 26.11.2 ~ 27.2.28");
});
