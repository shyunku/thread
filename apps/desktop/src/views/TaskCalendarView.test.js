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

const task = (id, title, dueDate, done = false) => ({ id, title, dueDate, done, categories: {}, subtasks: {}, getFulfilledSubTaskCount: () => 0 });

test("the day panel shows remaining or passed time, dims done tasks and shares hover both ways", () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
  const tasks = { a: task("a", "보고서", new Date(2026, 9, 4, 14, 0)), b: task("b", "회고", new Date(2026, 9, 4, 9, 0)), c: task("c", "정리", new Date(2026, 9, 4, 8, 0), true) };
  const setHovered = jest.fn();
  const { rerender } = render(<TaskCalendarView filteredTaskMap={tasks} categories={{}} setHoveredTaskId={setHovered} hoveredTaskId={null} />);
  const panel = screen.getByRole("region", { name: "선택한 날짜의 할 일" });
  const row = (title) => [...panel.querySelectorAll(".selected-day-task")].find((el) => el.textContent.includes(title));
  expect(row("보고서")).toHaveTextContent("2시간 남음");
  expect(row("회고").querySelector(".selected-day-task__time")).toHaveClass("overdue");
  expect(row("정리")).toHaveClass("done");
  expect(row("정리").querySelector(".selected-day-task__time")).not.toHaveClass("overdue");
  fireEvent.mouseEnter(row("보고서"));
  expect(setHovered).toHaveBeenCalledWith("a");
  rerender(<TaskCalendarView filteredTaskMap={tasks} categories={{}} setHoveredTaskId={setHovered} hoveredTaskId="b" />);
  expect(row("회고")).toHaveClass("hovered");
});
