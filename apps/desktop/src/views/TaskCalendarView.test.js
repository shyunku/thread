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

test("with the shared header: view switch and view options (no eye: the lock is in the top bar)", () => {
  const onView = jest.fn();
  const header = { view: "calendar", onView, prefs: {}, onPref: jest.fn() };
  setup({ header });
  expect(screen.getByRole("button", { name: "캘린더" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: /비밀 카테고리/ })).toBeNull();
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

test("the summary is only the month's open tasks (no hint about pressing a day)", () => {
  const tasks = { a: task("a", "보고서", at(2026, 9, 25, 9)), b: task("b", "다음 달", at(2026, 10, 2, 9)) };
  setup({ filteredTaskMap: tasks });
  expect(document.querySelector(".tc-finding")).toHaveTextContent(/^이번 달 남은 할 일 1개$/);
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  expect(document.querySelector(".tc-finding")).toHaveTextContent(/^11월 남은 할 일 1개$/);
  expect(screen.queryByText(/날짜를 누르면/)).toBeNull();
});

test("‹ › tooltips name the Shift step; Shift+press moves a year", () => {
  setup();
  const prev = screen.getByRole("button", { name: "이전 달" }), next = screen.getByRole("button", { name: "다음 달" });
  expect(prev).toHaveAttribute("data-tip", "이전 달 · Shift 이전 해");
  expect(next).toHaveAttribute("data-tip", "다음 달 · Shift 다음 해");
  fireEvent.click(next, { shiftKey: true });
  expect(screen.getByRole("heading", { name: "2027년 10월" })).toBeInTheDocument();
  fireEvent.click(prev, { shiftKey: true });
  fireEvent.click(prev, { shiftKey: true });
  expect(screen.getByRole("heading", { name: "2025년 10월" })).toBeInTheDocument();
  expect(picked).toBe(startOfDay(NOW));
});

test("the title opens the month popup: the shown month filled, the current ringed, ‹ › change the year", () => {
  setup();
  const title = screen.getByRole("button", { name: "2026년 10월" });
  expect(title).toHaveAttribute("data-tip", "달로 가기");
  expect(title).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(title);
  const pop = screen.getByRole("dialog", { name: "달로 가기" });
  expect(title).toHaveAttribute("aria-expanded", "true");
  expect(title).toHaveClass("on");
  expect(title).not.toHaveAttribute("data-tip");
  const months = () => within(pop).getAllByRole("button").filter((el) => el.classList.contains("jp-m"));
  expect(months().map((el) => el.textContent)).toEqual(["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"]);
  expect(months()[9]).toHaveClass("cur", "today");
  expect(document.activeElement).toBe(months()[9]);
  expect(within(pop).getByText("2026년")).toBeInTheDocument();
  // A different month shown: it is filled, the current one only ringed.
  fireEvent.click(title);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  fireEvent.click(screen.getByRole("button", { name: "2026년 11월" }));
  const pop2 = screen.getByRole("dialog", { name: "달로 가기" });
  const m2 = within(pop2).getAllByRole("button").filter((el) => el.classList.contains("jp-m"));
  expect(m2[10]).toHaveClass("cur");
  expect(m2[10]).not.toHaveClass("today");
  expect(m2[9]).toHaveClass("today");
  expect(m2[9]).not.toHaveClass("cur");
  fireEvent.click(within(pop2).getByRole("button", { name: "다음 해" }));
  expect(within(pop2).getByText("2027년")).toBeInTheDocument();
  expect(pop2.querySelector(".jp-m.cur, .jp-m.today")).toBeNull();
  expect(within(pop2).getByRole("button", { name: "이전 해" })).toHaveAttribute("data-tip", "이전 해");
});

test("picking a month shows it and closes the popup; the picked day stays; 이번 달 comes back", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "2026년 10월" }));
  let pop = screen.getByRole("dialog", { name: "달로 가기" });
  fireEvent.click(within(pop).getByRole("button", { name: "다음 해" }));
  fireEvent.click(within(pop).getByRole("button", { name: "3월" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("heading", { name: "2027년 3월" })).toBeInTheDocument();
  expect(picked).toBe(startOfDay(NOW));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "2027년 3월" }));
  fireEvent.click(screen.getByRole("button", { name: "2027년 3월" }));
  pop = screen.getByRole("dialog", { name: "달로 가기" });
  expect(within(pop).getByText("2027년")).toBeInTheDocument();
  fireEvent.click(within(pop).getByRole("button", { name: "이번 달" }));
  expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the month popup: arrow keys move between months, Esc and a press outside close it", () => {
  setup();
  const title = screen.getByRole("button", { name: "2026년 10월" });
  fireEvent.click(title);
  const pop = screen.getByRole("dialog", { name: "달로 가기" });
  const month = (n) => within(pop).getByRole("button", { name: `${n}월` });
  fireEvent.keyDown(month(10), { key: "ArrowDown" });
  expect(document.activeElement).toBe(month(12));
  fireEvent.keyDown(month(12), { key: "ArrowUp" });
  fireEvent.keyDown(month(8), { key: "ArrowLeft" });
  expect(document.activeElement).toBe(month(7));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(title);
  fireEvent.click(title);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();
});
