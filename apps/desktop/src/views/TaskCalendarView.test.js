import { act, fireEvent, render, screen } from "@testing-library/react";
import TaskCalendarView from "./TaskCalendarView";

jest.mock("react-redux", () => ({ useSelector: () => ({ weekStart: 0 }) }));

afterEach(() => jest.useRealTimers());

const heading = () => screen.getByRole("region", { name: "선택한 날짜의 할 일" }).querySelector("h3").textContent;

test("a selected today follows to the next day at midnight", () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 31, 23, 59, 58));
  render(<TaskCalendarView taskMap={{}} filteredTaskMap={{}} categories={{}} />);
  expect(heading()).toMatch(/^10월 31일 /);
  act(() => { jest.advanceTimersByTime(3000); });
  expect(heading()).toMatch(/^11월 1일 /);
  expect(screen.getByText("2026년 11월")).toBeInTheDocument();
});

test("a different selected day stays put at midnight", () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 4, 23, 59, 58));
  render(<TaskCalendarView taskMap={{}} filteredTaskMap={{}} categories={{}} />);
  fireEvent.click(screen.getByRole("button", { name: "2026년 10월 10일" }));
  act(() => { jest.advanceTimersByTime(3000); });
  expect(heading()).toMatch(/^10월 10일 /);
});
