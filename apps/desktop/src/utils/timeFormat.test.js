import { withTimeFormat } from "./timeFormat";

test("12-hour patterns convert to 24-hour only when selected", () => {
  expect(withTimeFormat("a h:mm:ss", "12")).toBe("a h:mm:ss");
  expect(withTimeFormat("a h:mm:ss", "24")).toBe("HH:mm:ss");
  expect(withTimeFormat(" A h시 mm분", "24")).toBe(" H시 mm분");
  expect(withTimeFormat("YY년 M월 D일 (ddd) A h시 mm분", "24")).toBe("YY년 M월 D일 (ddd) H시 mm분");
  expect(withTimeFormat("a h시 mm분 ss초", "24")).toBe("H시 mm분 ss초");
});
