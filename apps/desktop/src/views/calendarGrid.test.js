// The calendar/date picker use: leading = (firstDay - weekStart + 7) % 7,
// trailing = (weekStart + 6 - lastDay) % 7. Every month must fill whole weeks.
const cells = (year, month, weekStart) => {
  const first = new Date(year, month, 1).getDay(), last = new Date(year, month + 1, 0);
  return (first - weekStart + 7) % 7 + last.getDate() + (weekStart + 6 - last.getDay()) % 7;
};

test("leading and trailing cells fill complete weeks for both week starts", () => {
  for (const weekStart of [0, 1])
    for (let month = 0; month < 24; month++)
      expect(cells(2026 + Math.floor(month / 12), month % 12, weekStart) % 7).toBe(0);
  // October 2026 starts on Thursday: 4 leading cells from Sunday, 3 from Monday.
  expect((new Date(2026, 9, 1).getDay() - 0 + 7) % 7).toBe(4);
  expect((new Date(2026, 9, 1).getDay() - 1 + 7) % 7).toBe(3);
});
