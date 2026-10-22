import { TODO_MENU_TYPE, inMenu, isSecretTask, sidebarCounts } from "./menuFilters";
import { contrastRatio, hexToHsv, hsvToHex, isLowContrast, nextPaletteColor, normalizeHex } from "./categoryColors";

const NOW = new Date(2026, 9, 21, 14, 30).getTime();
const day = (days, hour = 12) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const t = (dueDate, extra = {}) => ({ dueDate, categories: {}, done: false, important: false, ...extra });

test("오늘 includes overdue, 다음 7일 is under 7 days with overdue, none without a due", () => {
  expect(inMenu(TODO_MENU_TYPE.TODAY, t(day(-3)), NOW)).toBe(true);
  expect(inMenu(TODO_MENU_TYPE.TODAY, t(day(0, 23)), NOW)).toBe(true);
  expect(inMenu(TODO_MENU_TYPE.TODAY, t(day(1, 0)), NOW)).toBe(false);
  expect(inMenu(TODO_MENU_TYPE.TODAY, t(null), NOW)).toBe(false);
  expect(inMenu(TODO_MENU_TYPE.NEXT_7_DAYS, t(day(-10)), NOW)).toBe(true);
  expect(inMenu(TODO_MENU_TYPE.NEXT_7_DAYS, t(day(6, 23)), NOW)).toBe(true);
  expect(inMenu(TODO_MENU_TYPE.NEXT_7_DAYS, t(day(7, 0)), NOW)).toBe(false);
  expect(inMenu(TODO_MENU_TYPE.IMPORTANT, t(null, { important: true }), NOW)).toBe(true);
  expect(inMenu(TODO_MENU_TYPE.ALL, t(null), NOW)).toBe(true);
});

test("a task is secret when any category is secret; counts skip it unless the eye is on", () => {
  const categories = { a: { secret: false }, s: { secret: true } };
  const mixed = t(day(0), { categories: { a: true, s: true } });
  expect(isSecretTask(mixed, categories)).toBe(true);
  const plain = t(day(-1), { categories: { a: true } });
  const done = t(day(0), { categories: { a: true }, done: true });
  const tasks = { mixed, plain, done };
  let { counts, overdue } = sidebarCounts(tasks, categories, { now: NOW });
  expect(counts[TODO_MENU_TYPE.ALL]).toBe(1);
  expect(counts[TODO_MENU_TYPE.TODAY]).toBe(1);
  expect(counts.a).toBe(1);
  expect(counts.s).toBeUndefined();
  expect(overdue).toBe(true);
  ({ counts } = sidebarCounts(tasks, categories, { now: NOW, showSecret: true }));
  expect(counts[TODO_MENU_TYPE.ALL]).toBe(2);
  expect(counts.a).toBe(2);
  // A hidden overdue secret task does not turn 오늘 red.
  ({ overdue } = sidebarCounts({ x: t(day(-1), { categories: { s: true } }) }, categories, { now: NOW }));
  expect(overdue).toBe(false);
});

test("palette helpers: next unused colour, hex and HSV, contrast", () => {
  expect(nextPaletteColor({})).toBe("#6294ff");
  expect(nextPaletteColor({ a: { color: "#6294FF" }, b: { color: "#4fc3d9" } })).toBe("#44c98b");
  expect(normalizeHex("ABC")).toBe("#aabbcc");
  expect(normalizeHex("nope")).toBeNull();
  const { h, s, v } = hexToHsv("#6294ff");
  expect(hsvToHex(h, s, v)).toBe("#6294ff");
  expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21);
  expect(isLowContrast("#202020")).toBe(true);
  expect(isLowContrast("#6294ff")).toBe(false);
});
