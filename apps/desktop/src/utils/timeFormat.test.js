import { configureStore } from "@reduxjs/toolkit";
import { renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import prefsReducer from "../store/prefsSlice";
import { useTimeFormat, useWeekStart, withTimeFormat } from "./timeFormat";

test("12-hour patterns convert to 24-hour only when selected", () => {
  expect(withTimeFormat("a h:mm:ss", "12")).toBe("a h:mm:ss");
  expect(withTimeFormat("a h:mm:ss", "24")).toBe("HH:mm:ss");
  expect(withTimeFormat(" A h시 mm분", "24")).toBe(" H시 mm분");
  expect(withTimeFormat("YY년 M월 D일 (ddd) A h시 mm분", "24")).toBe("YY년 M월 D일 (ddd) H시 mm분");
  expect(withTimeFormat("a h시 mm분 ss초", "24")).toBe("H시 mm분 ss초");
});

test("hooks read 시각 형식 and 주 시작 요일 from the prefs", () => {
  const read = (prefs) => {
    const store = configureStore({ reducer: { prefs: prefsReducer }, preloadedState: { prefs } });
    return renderHook(() => [useTimeFormat(), useWeekStart()], { wrapper: ({ children }) => <Provider store={store}>{children}</Provider> }).result.current;
  };
  expect(read({ timeFormat: "24", weekStart: 1 })).toEqual(["24", 1]);
  expect(read({})).toEqual(["12", 0]);
});
