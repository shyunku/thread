import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Provider } from "react-redux";
import { PickedDayContext, startOfDay } from "components/panel/pickedDay";
import prefsReducer, { setPrefs } from "store/prefsSlice";
import TaskCalendarView, { cellItems, cellLines, daySort } from "./TaskCalendarView";

const NOW = new Date(2026, 9, 21, 14, 30); // Wednesday
const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min);
const task = (id, title, dueDate, extra = {}) => ({ id, title, dueDate, done: false, categories: {}, subtasks: {}, ...extra });

let picked;
function Harness({ initialDay = NOW, ...props }) {
  const [day, setDay] = useState(() => startOfDay(initialDay));
  picked = day;
  return (
    <PickedDayContext.Provider value={{ pickedDay: day, setPickedDay: (d) => setDay(startOfDay(d)) }}>
      <TaskCalendarView filteredTaskMap={{}} categories={{}} {...props} />
    </PickedDayContext.Provider>
  );
}
function setup(props = {}, prefs) {
  const store = configureStore({ reducer: { prefs: prefsReducer } });
  if (prefs) store.dispatch(setPrefs(prefs));
  return render(<Provider store={store}><Harness {...props} /></Provider>);
}
const grid = () => screen.getByRole("grid");
const cells = () => within(grid()).getAllByRole("gridcell");
const cell = (d) => grid().querySelector(`[data-day="${startOfDay(d)}"]`);
const weekdays = () => within(grid()).getAllByRole("columnheader").map((el) => el.textContent);

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
afterEach(() => { jest.useRealTimers(); });

test("the grid starts on 주 시작 요일 and has as many weeks as the month needs", () => {
  const { unmount } = setup();
  expect(weekdays()).toEqual(["일", "월", "화", "수", "목", "금", "토"]);
  // October 2026 starts on Thursday: from Sunday Sep 27, 5 weeks.
  expect(cells()).toHaveLength(35);
  expect(cells()[0]).toHaveAttribute("aria-label", "2026년 9월 27일");
  expect(grid().style.gridTemplateRows).toBe("28px repeat(5, minmax(0, 1fr))");
  unmount();
  setup({}, { weekStart: 1 });
  expect(weekdays()).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
  expect(cells()[0]).toHaveAttribute("aria-label", "2026년 9월 28일");
  expect(cells()).toHaveLength(35);
  // August 2026 from Sunday needs 6 weeks (Sat 1st … Mon 31st).
  fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
  fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
  expect(screen.getByRole("heading", { name: "2026년 8월" })).toBeInTheDocument();
  expect(cells()).toHaveLength(42);
  expect(grid().style.gridTemplateRows).toBe("28px repeat(6, minmax(0, 1fr))");
});

test("weekend colours follow the weekday, not the column", () => {
  setup({}, { weekStart: 1 });
  const head = within(grid()).getAllByRole("columnheader");
  expect(head[5]).toHaveClass("sat");
  expect(head[6]).toHaveClass("sun");
  expect(cell(at(2026, 9, 24))).toHaveClass("sat");
  expect(cell(at(2026, 9, 25))).toHaveClass("sun");
  expect(cell(at(2026, 9, 21))).not.toHaveClass("sat", "sun");
  expect(cell(at(2026, 8, 28))).toHaveClass("out");
});

test("today and the picked day mark the day number; a press picks the day, the month follows", () => {
  setup();
  expect(cell(NOW)).toHaveClass("today", "picked");
  expect(cell(NOW)).toHaveAttribute("aria-current", "date");
  fireEvent.click(cell(at(2026, 9, 23)));
  expect(picked).toBe(startOfDay(at(2026, 9, 23)));
  expect(cell(at(2026, 9, 23))).toHaveClass("picked");
  expect(cell(NOW)).toHaveClass("today");
  expect(cell(NOW)).not.toHaveClass("picked");
  // A day of the month before shown in the grid: picked, and the grid moves to that month.
  fireEvent.click(cell(at(2026, 8, 28)));
  expect(screen.getByRole("heading", { name: "2026년 9월" })).toBeInTheDocument();
  expect(cell(at(2026, 8, 28))).toHaveClass("picked");
  // Arrow keys move the pick.
  fireEvent.keyDown(cell(at(2026, 8, 28)), { key: "ArrowDown" });
  expect(picked).toBe(startOfDay(at(2026, 9, 5)));
  expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();
});

test("month navigation: ‹ › move the month, 오늘 goes back and picks today", () => {
  setup();
  expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  expect(screen.getByRole("heading", { name: "2027년 1월" })).toBeInTheDocument();
  // The picked day stays when only the month moves.
  expect(picked).toBe(startOfDay(NOW));
  fireEvent.click(cell(at(2027, 0, 15)));
  fireEvent.click(screen.getByRole("button", { name: "오늘" }));
  expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();
  expect(picked).toBe(startOfDay(NOW));
  fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
  expect(screen.getByRole("heading", { name: "2026년 9월" })).toBeInTheDocument();
});

test("a day shows 3 items (open first, then by due) and …외 N개; overdue red, done struck; secret tasks get the shield", () => {
  const categories = {
    work: { id: "work", title: "업무", color: "#44c98b", secret: false },
    hid: { id: "hid", title: "비밀", color: "#f06292", secret: true },
  };
  const tasks = {
    a: task("a", "보고서", at(2026, 9, 21, 9), { categories: { work: true } }),
    b: task("b", "회의", at(2026, 9, 21, 16)),
    c: task("c", "끝난 일", at(2026, 9, 21, 8), { done: true }),
    d: task("d", "비밀 일", at(2026, 9, 21, 18), { categories: { work: true, hid: true } }),
    e: task("e", "저녁", at(2026, 9, 21, 20)),
    f: task("f", "내일 일", at(2026, 9, 22, 10), { done: true }),
    g: task("g", "기한 없음", null),
  };
  setup({ filteredTaskMap: tasks, categories });
  const items = [...cell(NOW).querySelectorAll(".cv-ev")];
  expect(items.map((el) => el.textContent)).toEqual(["보고서", "회의", "비밀 일", "…외 2개"]);
  expect(items[0]).toHaveClass("over");
  expect(items[0].querySelector(".dot")).toHaveStyle({ background: "#44c98b" });
  expect(items[2].querySelector(".shield")).not.toBeNull();
  expect(items[2].querySelector(".shield")).toHaveStyle({ color: "#f06292" });
  expect(items[3]).toHaveClass("more");
  const tomorrow = cell(at(2026, 9, 22)).querySelector(".cv-ev");
  expect(tomorrow).toHaveClass("done");
  expect(tomorrow).not.toHaveClass("over");
  expect(screen.getByText(/이번 달 남은 할 일 4개/)).toBeInTheDocument();
});

test("완료한 할 일 숨기기 leaves done tasks out", () => {
  const tasks = { a: task("a", "열린 일", at(2026, 9, 22, 9)), b: task("b", "끝난 일", at(2026, 9, 22, 8), { done: true }) };
  setup({ filteredTaskMap: tasks }, { hideDone: true });
  expect([...cell(at(2026, 9, 22)).querySelectorAll(".cv-ev")].map((el) => el.textContent)).toEqual(["열린 일"]);
});

test("right-click on an item opens the task menu; the quick add gets the picked day", () => {
  const onTaskContextMenu = jest.fn();
  const renderQuickAdd = jest.fn((day) => <div data-testid="qa">{day}</div>);
  setup({ filteredTaskMap: { a: task("a", "보고서", at(2026, 9, 23, 9)) }, onTaskContextMenu, renderQuickAdd });
  expect(screen.getByTestId("qa")).toHaveTextContent(String(startOfDay(NOW)));
  fireEvent.contextMenu(screen.getByText("보고서"), { clientX: 40, clientY: 50 });
  expect(onTaskContextMenu).toHaveBeenCalledTimes(1);
  expect(onTaskContextMenu.mock.calls[0][1]).toBe("a");
  expect(picked).toBe(startOfDay(NOW));
  fireEvent.click(cell(at(2026, 9, 23)));
  expect(screen.getByTestId("qa")).toHaveTextContent(String(startOfDay(at(2026, 9, 23))));
});

test("without the optional props the view still draws (no quick add, no menu)", () => {
  setup({ filteredTaskMap: { a: task("a", "보고서", at(2026, 9, 23, 9)) } });
  fireEvent.contextMenu(screen.getByText("보고서"));
  expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "캘린더" })).toBeNull();
});

test("with the shared header: view switch, view options and the eye", () => {
  const onView = jest.fn();
  const header = { view: "calendar", onView, prefs: {}, onPref: jest.fn(), eye: { on: false, onToggle: jest.fn() } };
  setup({ header });
  expect(screen.getByRole("button", { name: "캘린더" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "비밀 카테고리 보기" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
  expect(onView).toHaveBeenCalledWith("timeline");
  // ‹ 오늘 › sit right after the title.
  expect(screen.getByRole("heading").nextElementSibling).toHaveClass("tc-nav");
});

test("the 오늘 ring follows the date at midnight", () => {
  jest.setSystemTime(new Date(2026, 9, 31, 23, 59, 58));
  setup({}, { weekStart: 1 }); // the grid then runs to Sunday Nov 1
  expect(cell(at(2026, 9, 31))).toHaveClass("today");
  act(() => { jest.advanceTimersByTime(3000); });
  expect(cell(at(2026, 10, 1))).toHaveClass("today");
});

test("cell items shrink to the room a short cell has", () => {
  const list = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  expect(cellItems(list)).toEqual({ shown: list.slice(0, 3), more: 2 });
  expect(cellItems(list.slice(0, 3))).toEqual({ shown: list.slice(0, 3), more: 0 });
  expect(cellItems(list, cellLines(38 + 24 * 2))).toEqual({ shown: list.slice(0, 1), more: 4 });
  expect(cellItems(list.slice(0, 2), cellLines(38 + 24 * 2))).toEqual({ shown: list.slice(0, 2), more: 0 });
  expect(cellItems(list, cellLines(40))).toEqual({ shown: [], more: 5 });
  expect(cellLines(0)).toBe(Infinity);
});

test("daySort puts open tasks first, then by due", () => {
  const list = [task("late", "", 50), task("done", "", 10, { done: true }), task("early", "", 20)];
  expect(daySort(list).map((t) => t.id)).toEqual(["early", "late", "done"]);
});

test("arrow keys into another month: the grid moves and the focus follows the picked day", () => {
  setup({ initialDay: at(2026, 9, 31) });
  cell(at(2026, 9, 31)).focus();
  fireEvent.keyDown(cell(at(2026, 9, 31)), { key: "ArrowRight" });
  expect(screen.getByRole("heading", { name: "2026년 11월" })).toBeInTheDocument();
  expect(document.activeElement).toBe(cell(at(2026, 10, 1)));
  fireEvent.keyDown(document.activeElement, { key: "ArrowUp" });
  expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();
  expect(document.activeElement).toBe(cell(at(2026, 9, 25)));
});

test("grid rows: the weekday row, then one row of 7 days per week", () => {
  setup();
  const rows = within(grid()).getAllByRole("row");
  expect(rows).toHaveLength(6);
  expect(within(rows[0]).getAllByRole("columnheader")).toHaveLength(7);
  rows.slice(1).forEach((r) => expect(within(r).getAllByRole("gridcell")).toHaveLength(7));
});

test("an item's menu returns focus to its day (items cannot take focus)", () => {
  const onTaskContextMenu = jest.fn();
  setup({ filteredTaskMap: { a: task("a", "보고서", at(2026, 9, 23, 9)) }, onTaskContextMenu });
  fireEvent.contextMenu(screen.getByText("보고서"));
  expect(onTaskContextMenu.mock.calls[0][2]).toBe(cell(at(2026, 9, 23)));
});

test("in search the summary says it shows the results", () => {
  setup({ searchNote: "검색 결과 3개" });
  expect(document.querySelector(".tc-finding")).toHaveTextContent(/^검색 결과 3개 · 이번 달 남은 할 일 0개/);
});
