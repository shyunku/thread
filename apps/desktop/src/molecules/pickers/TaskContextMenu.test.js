import { fireEvent, render, screen } from "@testing-library/react";
import TaskContextMenu, { menuDue } from "./TaskContextMenu";

jest.mock("react-redux", () => ({ useSelector: () => ({ weekStart: 0, timeFormat: "12" }) }));

const at = (m, d, h = 12, min = 0, s = 0) => new Date(2026, m - 1, d, h, min, s).getTime();
const NOW = at(10, 21, 14, 30);
const CATS = [
  { id: "work", title: "업무", color: "#6294ff" },
  { id: "diary", title: "일기", color: "#e57ad6", secret: true },
];
const parts = (ms) => { const d = new Date(ms); return [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]; };
const setup = (props = {}) => {
  const cb = {
    onOpen: jest.fn(), onSetDue: jest.fn(), onToggleImportant: jest.fn(), onToggleCategory: jest.fn(),
    onNewCategory: jest.fn(), onDuplicate: jest.fn(), onDelete: jest.fn(), onClose: jest.fn(),
  };
  const utils = render(<TaskContextMenu point={{ x: 300, y: 200 }} now={NOW} categories={CATS} categoryIds={["work"]} {...cb} {...props} />);
  return { ...cb, ...utils };
};
const labels = () => [...document.querySelectorAll(".tp-menu-in > .tp-mi")].map((el) => el.querySelector(".tp-lb").textContent);
const item = (name) => screen.getByRole("menuitem", { name: new RegExp(`^${name}`) });

test("items depend on the task: no due date, not important", () => {
  setup();
  expect(labels()).toEqual(["열기", "오늘", "내일", "날짜 · 기간 정하기…", "알림", "중요로 표시", "카테고리", "복제", "삭제"]);
  expect(item("열기")).toHaveTextContent("Enter");
  expect(item("삭제")).toHaveTextContent("Del");
  expect(item("삭제")).toHaveClass("danger");
});

test("with a due date and starred", () => {
  setup({ due: at(10, 25, 14, 30), important: true });
  expect(labels()).toEqual(["열기", "오늘", "내일", "하루 미루기", "일주일 미루기", "날짜 · 기간 정하기…", "기한 없애기", "알림", "중요 해제", "카테고리", "복제", "삭제"]);
});

test("오늘 / 내일 keep the time of day; no due means the end of the day", () => {
  expect(parts(menuDue("today", at(10, 25, 14, 30), NOW))).toEqual([10, 21, 14, 30, 0]);
  expect(parts(menuDue("tomorrow", at(10, 25, 14, 30), NOW))).toEqual([10, 22, 14, 30, 0]);
  expect(parts(menuDue("today", null, NOW))).toEqual([10, 21, 23, 59, 59]);
  expect(parts(menuDue("tomorrow", null, at(10, 31, 9)))).toEqual([11, 1, 23, 59, 59]);
  expect(parts(menuDue("plus1", at(10, 31, 18), NOW))).toEqual([11, 1, 18, 0, 0]);
  expect(parts(menuDue("plus7", at(10, 28, 18), NOW))).toEqual([11, 4, 18, 0, 0]);
  expect(menuDue("plus1", null, NOW)).toBe(null);
});

test("due actions call onSetDue and close", () => {
  const due = at(10, 25, 14, 30);
  const cases = [["오늘", [10, 21, 14, 30, 0]], ["내일", [10, 22, 14, 30, 0]], ["하루 미루기", [10, 26, 14, 30, 0]], ["일주일 미루기", [11, 1, 14, 30, 0]]];
  for (const [name, expected] of cases) {
    const { onSetDue, onClose, unmount } = setup({ due });
    fireEvent.click(item(name));
    expect(parts(onSetDue.mock.calls[0][0])).toEqual(expected);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  }
  const { onSetDue } = setup({ due });
  fireEvent.click(item("기한 없애기"));
  expect(onSetDue).toHaveBeenCalledWith(null);
});

test("the other actions", () => {
  const cb = setup();
  fireEvent.click(item("열기"));
  fireEvent.click(item("중요로 표시"));
  fireEvent.click(item("복제"));
  fireEvent.click(item("삭제"));
  expect([cb.onOpen, cb.onToggleImportant, cb.onDuplicate, cb.onDelete].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
  expect(cb.onClose).toHaveBeenCalledTimes(4);
});

test("category submenu: opens on hover, ticks stay open, closes on another item", () => {
  const { onToggleCategory, onClose, onNewCategory } = setup();
  fireEvent.mouseEnter(item("카테고리"));
  const sub = screen.getByRole("menu", { name: "카테고리" });
  expect(screen.getByRole("menuitemcheckbox", { name: /업무/ })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("menuitemcheckbox", { name: /일기/ })).toHaveAttribute("aria-checked", "false");
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /일기/ }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /업무/ }));
  expect(onToggleCategory.mock.calls).toEqual([["diary"], ["work"]]);
  expect(onClose).not.toHaveBeenCalled();
  expect(sub).toBeInTheDocument();
  // A press inside the submenu does not close the menu under it.
  fireEvent.mouseDown(screen.getByRole("menuitemcheckbox", { name: /일기/ }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.mouseEnter(item("복제"));
  expect(screen.queryByRole("menu", { name: "카테고리" })).toBeNull();
  fireEvent.mouseEnter(item("카테고리"));
  fireEvent.click(screen.getByRole("menuitem", { name: "새 카테고리…" }));
  expect(onNewCategory).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("keyboard: arrows, the submenu with → / ← / Esc, Del", () => {
  const { onClose, onDelete } = setup();
  const menu = screen.getByRole("menu", { name: "할 일 메뉴" });
  expect(document.activeElement).toBe(menu);
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement).toBe(item("열기"));
  fireEvent.keyDown(menu, { key: "ArrowUp" });
  expect(document.activeElement).toBe(item("삭제"));
  fireEvent.keyDown(menu, { key: "ArrowUp" });
  fireEvent.keyDown(menu, { key: "ArrowUp" });
  expect(document.activeElement).toBe(item("카테고리"));
  fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox", { name: /업무/ }));
  fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox", { name: /일기/ }));
  fireEvent.keyDown(document.activeElement, { key: "ArrowLeft" });
  expect(screen.queryByRole("menu", { name: "카테고리" })).toBeNull();
  expect(document.activeElement).toBe(item("카테고리"));
  fireEvent.keyDown(document.activeElement, { key: "Enter" });
  expect(screen.getByRole("menu", { name: "카테고리" })).toBeInTheDocument();
  // Esc closes only the top popup: the submenu first, then the menu.
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(screen.queryByRole("menu", { name: "카테고리" })).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(item("카테고리"));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(menu, { key: "Delete" });
  expect(onDelete).toHaveBeenCalledTimes(1);
});

test("날짜 · 기간 정하기… swaps in the date picker; 정하기 sets the due", () => {
  const { onSetDue, onClose } = setup({ due: at(10, 25, 14, 30) });
  fireEvent.click(item("날짜 · 기간 정하기…"));
  expect(screen.queryByRole("menu", { name: "할 일 메뉴" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "기한 정하기" })).toBeInTheDocument();
  fireEvent.click(document.querySelector('[data-day="2026-10-30"]'));
  fireEvent.click(screen.getByRole("button", { name: "정하기" }));
  expect(parts(onSetDue.mock.calls[0][0])).toEqual([10, 30, 14, 30, 0]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a press outside closes the menu", () => {
  const { onClose } = setup();
  fireEvent.mouseDown(document.body);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Enter on the menu itself is 열기; Tab closes the menu", () => {
  const { onOpen, onClose } = setup();
  const menu = screen.getByRole("menu", { name: "할 일 메뉴" });
  expect(document.activeElement).toBe(menu);
  fireEvent.keyDown(menu, { key: "Enter" });
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(menu, { key: "Tab" });
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("events inside the menu do not reach the React parents (the task row)", () => {
  const onRowClick = jest.fn(), onRowKey = jest.fn(), onRowDown = jest.fn();
  const cb = { onDelete: jest.fn(), onClose: jest.fn() };
  render(
    <div onClick={onRowClick} onKeyDown={onRowKey} onMouseDown={onRowDown}>
      <TaskContextMenu point={{ x: 0, y: 0 }} now={NOW} categories={CATS} {...cb} />
    </div>
  );
  fireEvent.mouseDown(item("복제"));
  fireEvent.click(item("복제"));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Delete" });
  expect(cb.onDelete).toHaveBeenCalledTimes(1);
  expect(onRowClick).not.toHaveBeenCalled();
  expect(onRowKey).not.toHaveBeenCalled();
  expect(onRowDown).not.toHaveBeenCalled();
});

test("a due of 0 is no due; a Date due works like ms", () => {
  setup({ due: 0 });
  expect(labels()).not.toContain("하루 미루기");
  expect(menuDue("plus1", new Date(at(10, 21, 9)), NOW)).toBe(at(10, 22, 9));
  expect(menuDue("plus1", 0, NOW)).toBe(null);
});

test("the secret shield in the category submenu is labelled", () => {
  setup();
  fireEvent.mouseEnter(item("카테고리"));
  expect(screen.getByRole("img", { name: "비밀 카테고리" })).toBeInTheDocument();
});

describe("알림 ▸ (#109)", () => {
  const { taskAlerts } = require("utils/taskPeriod");
  const SETTINGS = { enabled: true, before: true, minutes: 10, due: true, startBefore: true, startMinutes: 10, startAt: false };
  const period = (start, due, extra = {}) => taskAlerts({ dueDate: due, startOffset: due - start, ...extra }, SETTINGS);
  const openAlerts = (alerts, props = {}) => {
    const onSetAlert = jest.fn();
    const utils = setup({ due: at(10, 25, 17), alerts, onSetAlert, ...props });
    fireEvent.mouseEnter(item("알림"));
    return { onSetAlert, ...utils, sub: screen.getByRole("menu", { name: "알림" }) };
  };
  const rows = () => [...screen.getByRole("menu", { name: "알림" }).querySelectorAll(".tp-mi")].map((el) => [el.querySelector(".tp-lb").textContent, el.querySelector(".tp-kb")?.textContent ?? "", el.className.includes("on")]);

  test("without a due the item is dimmed and says why", () => {
    setup();
    const el = [...document.querySelectorAll(".tp-menu-in > .tp-mi")].find((x) => x.textContent.startsWith("알림"));
    expect(el).toHaveClass("dis");
    expect(el).toHaveTextContent("기한 없음");
    expect(el).toHaveAttribute("data-tip", "기한을 정하면 알림을 받을 수 있어요");
  });

  test("both sides follow: 전체 설정 따르기 checked, each side with what rings", () => {
    openAlerts(period(at(10, 25, 14), at(10, 25, 17)));
    expect(rows()).toEqual([
      ["전체 설정 따르기", "", true],
      ["시작 알림10분 전", "전체 설정", true],
      ["끝 알림10분 전 · 정각", "전체 설정", true],
    ]);
    expect(screen.getByText("직접 켜고 끈 알림은 설정 > 알림을 바꿔도 그대로예요.")).toBeInTheDocument();
  });

  test("a row turns that side off or on for this task and keeps the menu open; 전체 설정 따르기 resets", () => {
    const { onSetAlert, onClose } = openAlerts(period(at(10, 25, 14), at(10, 25, 17), { alertEnd: "off" }));
    expect(rows()[0][2]).toBe(false);
    expect(rows()[2]).toEqual(["끝 알림꺼짐", "직접", false]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^시작 알림/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^끝 알림/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "전체 설정 따르기" }));
    expect(onSetAlert.mock.calls).toEqual([["start", "off"], ["end", "on"], ["end", null]]);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a due only shows 끝; a side without a time is dimmed with the note", () => {
    const { unmount } = openAlerts(taskAlerts({ dueDate: at(10, 25, 17) }, SETTINGS));
    expect(rows().map((r) => r[0])).toEqual(["전체 설정 따르기", "끝 알림10분 전 · 정각"]);
    unmount();
    openAlerts(period(at(10, 22, 0), at(10, 25, 17)));
    const dim = [...screen.getByRole("menu", { name: "알림" }).querySelectorAll(".tp-mi.dis")];
    expect(dim.map((el) => el.textContent)).toEqual(["시작 알림시각 없음"]);
    expect(screen.getByText("날짜만 정한 시작 · 끝은 알림이 없어요. 시각을 정하면 켤 수 있어요.")).toBeInTheDocument();
  });
});

test("날짜 · 기간 정하기… on a period gives the end and the start to onSetPeriod (#109)", () => {
  const onSetPeriod = jest.fn();
  const { onSetDue } = setup({ due: at(10, 25, 23, 59, 59), start: at(10, 22, 0), onSetPeriod });
  fireEvent.click(item("날짜 · 기간 정하기…"));
  expect(screen.getByRole("dialog", { name: "기간 정하기" })).toBeInTheDocument();
  fireEvent.click(document.querySelector('[data-day="2026-10-28"]'));
  fireEvent.click(screen.getByRole("button", { name: "정하기" }));
  expect(onSetPeriod).toHaveBeenCalledWith(at(10, 28, 23, 59, 59), at(10, 22, 0));
  expect(onSetDue).not.toHaveBeenCalled();
});
