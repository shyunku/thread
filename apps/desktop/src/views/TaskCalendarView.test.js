import { act, fireEvent, render, screen } from "@testing-library/react";
import TaskCalendarView, { sortByDue } from "./TaskCalendarView";

let mockPrefs = { weekStart: 0 };
jest.mock("react-redux", () => ({ useSelector: (select) => select({ prefs: mockPrefs }) }));

afterEach(() => { jest.useRealTimers(); mockPrefs = { weekStart: 0 }; });

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

test("the day panel lists the least time left first, overdue on top, in the chosen time display", () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
  const tasks = {
    a: task("a", "보고서", new Date(2026, 9, 4, 14, 0)),
    b: task("b", "회고", new Date(2026, 9, 4, 9, 30)),
    c: task("c", "정리", new Date(2026, 9, 4, 8, 0)),
    d: task("d", "장보기", new Date(2026, 9, 4, 20, 0)),
  };
  const { unmount } = render(<TaskCalendarView filteredTaskMap={tasks} categories={{}} />);
  const panel = () => screen.getByRole("region", { name: "선택한 날짜의 할 일" });
  const titles = () => [...panel().querySelectorAll(".selected-day-task__title")].map((el) => el.textContent);
  expect(titles()).toEqual(["정리", "회고", "보고서", "장보기"]);
  expect(panel().querySelector(".selected-day-task__time")).toHaveTextContent("4시간 지남");
  unmount();
  mockPrefs = { weekStart: 0, timeDisplay: "due", dueFormat: "auto", timeFormat: "24" };
  render(<TaskCalendarView filteredTaskMap={tasks} categories={{}} />);
  expect([...panel().querySelectorAll(".selected-day-task__time")].map((el) => el.textContent)).toEqual(["오늘 8시", "오늘 9시 30분", "오늘 14시", "오늘 20시"]);
});

test("sortByDue keeps ties in order and puts tasks without a due date last", () => {
  const list = [{ id: "none", dueDate: null }, { id: "late", dueDate: 50 }, { id: "tie1", dueDate: 10 }, { id: "tie2", dueDate: 10 }];
  expect(sortByDue(list).map((t) => t.id)).toEqual(["tie1", "tie2", "late", "none"]);
});
