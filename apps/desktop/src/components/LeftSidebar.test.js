import { act, fireEvent, render, screen, within } from "@testing-library/react";
import LeftSidebar, { resetOrderSupportForTests, syncLine } from "./LeftSidebar";
import { Popover } from "../molecules/pickers";
import Toast from "../molecules/Toast";
import Task from "../objects/Task";
import Category from "../objects/Category";
import IpcSender from "../utils/IpcSender";
import { SecretSessionProvider, useSecretSession } from "../hooks/useSecretSession";
import { TODO_MENU_TYPE } from "../utils/menuFilters";

let mockContext;
jest.mock("react-router-dom", () => ({ useOutletContext: () => mockContext }));
jest.mock("react-redux", () => ({
  useSelector: () => ({ uid: "fixture", username: "Jo", offlineMode: false, timeFormat: "12" }),
  useDispatch: () => () => {},
}));
jest.mock("../molecules/Modal", () => ({ openModal: jest.fn() }));
jest.mock("../molecules/Toast", () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn() } }));
jest.mock("../routers/ModalRouter", () => ({ MODAL_TYPES: { SETTINGS: "SETTINGS" } }));
jest.mock("../utils/IpcSender", () => {
  const fn = () => jest.fn((...args) => args.find((a) => typeof a === "function")?.({ success: true }));
  return {
    req: {
      category: {
        createCategory: fn(),
        deleteCategory: fn(),
        deleteCategoryInUse: fn(),
        deleteCategoryWithTasks: fn(),
        updateCategoryOrder: jest.fn(),
        updateCategoryTitle: fn(),
        updateCategoryColor: fn(),
      },
    },
    vault: { verifyUser: jest.fn(), onLocked: jest.fn(() => () => {}) },
    onAll: jest.fn(),
    offAll: jest.fn(),
    off: jest.fn(),
  };
});

// jsdom has no PointerEvent; the picker reads button and clientX from it.
if (!window.PointerEvent) window.PointerEvent = class PointerEvent extends MouseEvent {};

const DAY = 86400000;
const NOW = new Date(2026, 9, 21, 14, 30).getTime();
const at = (days, hour) => {
  const d = new Date(NOW + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const category = (id, title, color, secret = false, rank = null) => {
  const c = new Category(title, secret);
  c.id = id;
  c.color = color;
  c.sortRank = rank;
  return c;
};
const task = (id, { due = null, cats = [], done = false, important = false } = {}) => {
  const t = new Task(id, due);
  t.id = id;
  t.done = done;
  t.important = important;
  cats.forEach((c) => (t.categories[c] = true));
  return t;
};

let setSelected;
let session;
function Grab() {
  session = useSecretSession();
  return null;
}
function setup({ selected = TODO_MENU_TYPE.ALL, mode = "full", tasks, categories, syncStatus, searchQuery = "" } = {}) {
  const cats = categories ?? {
    work: category("work", "업무", "#6294ff", false, "10"),
    study: category("study", "공부", "#b58cff", false, "20"),
    exam: category("exam", "자격증 및 어학 시험 준비 (2026 하반기)", "#f0838b", false, "30"),
    diary: category("diary", "일기", "#e57ad6", true, "40"),
  };
  const list = tasks ?? [
    task("over", { due: at(-1, 18), cats: ["work"] }),
    task("today", { due: at(0, 21), cats: ["study"] }),
    task("five", { due: at(5, 10), cats: ["work"], important: true }),
    task("ten", { due: at(10, 10) }),
    task("none"),
    task("doneToday", { due: at(0, 12), cats: ["work"], done: true }),
    task("secret", { due: at(0, 9), cats: ["diary"] }),
    task("mixed", { due: at(1, 9), cats: ["work", "diary"] }),
  ];
  mockContext = {
    localNonce: 0,
    remoteNonce: 0,
    addPromise: jest.fn(),
    // E2EE status (protocolVersion 3): the category order can be changed.
    syncStatus: syncStatus ?? { protocolVersion: 3, ready: true, connected: true, syncing: false, pending: 0, error: null },
    states: { taskMap: Object.fromEntries(list.map((t) => [t.id, t])), categories: cats },
    searchQuery,
  };
  setSelected = jest.fn();
  return render(
    <SecretSessionProvider uid="fixture">
      <Grab />
      <LeftSidebar selectedTodoMenuType={selected} setSelectedTodoMenuType={setSelected} mode={mode} />
    </SecretSessionProvider>
  );
}

const navRow = (container, id) => container.querySelector(`[data-menu="${id}"]`);
const catRows = (container) => [...container.querySelectorAll(".cat-row")];
const count = (row) => row.querySelector(".n").textContent;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
  resetOrderSupportForTests();
});
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

test("nav order, labels and undone counts follow the #102 rules", () => {
  const { container } = setup();
  const labels = [...container.querySelectorAll("[data-menu]")].map((el) => el.textContent.replace(/\d+$/, ""));
  expect(labels).toEqual(["모든 할 일", "오늘", "다음 7일", "중요"]);
  // Secret tasks (any secret category) stay out; done tasks are not counted.
  expect(count(navRow(container, TODO_MENU_TYPE.ALL))).toBe("5");
  // 오늘 = today + overdue, red because something is overdue.
  const today = navRow(container, TODO_MENU_TYPE.TODAY);
  expect(count(today)).toBe("2");
  expect(today.querySelector(".n").classList.contains("due")).toBe(true);
  expect(today.querySelector(".badge")).not.toBeNull();
  // 다음 7일 = within 7 days, overdue included.
  expect(count(navRow(container, TODO_MENU_TYPE.NEXT_7_DAYS))).toBe("3");
  expect(count(navRow(container, TODO_MENU_TYPE.IMPORTANT))).toBe("1");
  const [work, study, exam, diary] = catRows(container);
  expect(count(work)).toBe("2");
  expect(count(study)).toBe("1");
  // Zero is blank; secret categories show no count.
  expect(count(exam)).toBe("");
  expect(count(diary)).toBe("");
  // Long names keep their tooltip; secret rows have the shield in the category colour.
  expect(exam.getAttribute("data-tip")).toBe("자격증 및 어학 시험 준비 (2026 하반기)");
  expect(diary.querySelector(".ic").style.color).toBe("rgb(229, 122, 214)");
  expect(diary.querySelector("svg")).not.toBeNull();
});

test("no overdue task means no red 오늘, and a blank zero", () => {
  const { container } = setup({ tasks: [task("later", { due: at(3, 10) })] });
  const today = navRow(container, TODO_MENU_TYPE.TODAY);
  expect(count(today)).toBe("");
  expect(today.querySelector(".badge")).toBeNull();
});

test("categories follow the synced sort_rank, and the rail hides labels behind tips", () => {
  const { container } = setup({
    mode: "rail",
    categories: {
      a: category("a", "A", "#6294ff", false, "30"),
      b: category("b", "B", "#44c98b", false, "10"),
      c: category("c", "C", "#f2c14e"),
    },
    tasks: [],
  });
  expect(catRows(container).map((r) => r.dataset.catrow)).toEqual(["b", "a", "c"]);
  expect(container.querySelector(".left-sidebar").classList.contains("rail")).toBe(true);
  expect(navRow(container, TODO_MENU_TYPE.TODAY).getAttribute("data-tip")).toBe("오늘");
  // Compact two-line clock.
  expect(container.querySelector(".side-clock.rail .cr").innerHTML).toContain("<br>");
});

test("the clock shows the long date and the time with small seconds", () => {
  const { container } = setup({ tasks: [] });
  expect(container.querySelector(".side-clock .cd").textContent).toBe("2026년 10월 21일 수요일");
  expect(container.querySelector(".side-clock b").textContent).toBe("오후 2:30:00");
  expect(container.querySelector(".side-clock b small").textContent).toBe(":00");
});

function placeRows(container) {
  catRows(container).forEach((row, i) => {
    row.getBoundingClientRect = () => ({ top: 100 + i * 34, bottom: 134 + i * 34, left: 10, right: 222, width: 212, height: 34 });
  });
}

test("dragging a category lifts after 4px, slides rows, settles and calls updateCategoryOrder with the anchor", () => {
  const { container } = setup();
  placeRows(container);
  const [work] = catRows(container);
  fireEvent.mouseDown(work, { button: 0, clientX: 20, clientY: 110 });
  fireEvent.mouseMove(document, { clientX: 22, clientY: 112 });
  expect(document.querySelector(".cat-ghost")).toBeNull();
  fireEvent.mouseMove(document, { clientX: 20, clientY: 180 });
  const ghost = document.querySelector(".cat-ghost");
  expect(ghost).not.toBeNull();
  expect(ghost.hasAttribute("data-tip")).toBe(false);
  expect(container.querySelector(".left-sidebar").classList.contains("sorting")).toBe(true);
  // Rows 1 and 2 slide up into the slot.
  expect(catRows(container)[1].style.transform).toBe("translateY(-34px)");
  expect(catRows(container)[2].style.transform).toBe("translateY(-34px)");
  expect(catRows(container)[3].style.transform).toBe("");
  // No context menu while lifted.
  const menuEvent = fireEvent.contextMenu(work);
  expect(menuEvent).toBe(false);
  fireEvent.mouseUp(document, { button: 0, clientX: 20, clientY: 180 });
  // The click that ends the drag does not open the category.
  fireEvent.click(work);
  expect(setSelected).not.toHaveBeenCalled();
  expect(IpcSender.req.category.updateCategoryOrder).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(200));
  expect(IpcSender.req.category.updateCategoryOrder).toHaveBeenCalledWith("work", "diary", false, expect.any(Function));
  expect(document.querySelector(".cat-ghost")).toBeNull();
  expect(container.querySelector(".left-sidebar").classList.contains("sorting")).toBe(false);
  // Optimistic order until the synced one arrives.
  expect(catRows(container).map((r) => r.dataset.catrow)).toEqual(["study", "exam", "work", "diary"]);
  expect(catRows(container).every((r) => r.style.transform === "")).toBe(true);
});

test("dragging to the end anchors after the last row", () => {
  const { container } = setup();
  placeRows(container);
  fireEvent.mouseDown(catRows(container)[0], { button: 0, clientX: 20, clientY: 110 });
  fireEvent.mouseMove(document, { clientX: 20, clientY: 300 });
  fireEvent.mouseUp(document, { button: 0 });
  act(() => jest.advanceTimersByTime(200));
  expect(IpcSender.req.category.updateCategoryOrder).toHaveBeenCalledWith("work", "diary", true, expect.any(Function));
});

test("Esc cancels a lifted row, nothing moves and the next click is swallowed", () => {
  const { container } = setup();
  placeRows(container);
  const [work] = catRows(container);
  fireEvent.mouseDown(work, { button: 0, clientX: 20, clientY: 110 });
  fireEvent.mouseMove(document, { clientX: 20, clientY: 160 });
  expect(document.querySelector(".cat-ghost")).not.toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(document.querySelector(".cat-ghost")).toBeNull();
  expect(catRows(container).every((r) => r.style.transform === "" && !r.classList.contains("lifted"))).toBe(true);
  fireEvent.mouseUp(document, { button: 0 });
  fireEvent.click(work);
  act(() => jest.advanceTimersByTime(500));
  expect(setSelected).not.toHaveBeenCalled();
  expect(IpcSender.req.category.updateCategoryOrder).not.toHaveBeenCalled();
  // A plain click (no drag) opens the category.
  fireEvent.mouseDown(work, { button: 0, clientX: 20, clientY: 110 });
  fireEvent.mouseUp(document, { button: 0 });
  fireEvent.click(work);
  expect(setSelected).toHaveBeenCalledWith("work");
});

test("a failed order reply restores the synced order", () => {
  IpcSender.req.category.updateCategoryOrder.mockImplementation((...args) => args[3]({ success: false }));
  const { container } = setup();
  placeRows(container);
  fireEvent.mouseDown(catRows(container)[0], { button: 0, clientX: 20, clientY: 110 });
  fireEvent.mouseMove(document, { clientX: 20, clientY: 180 });
  fireEvent.mouseUp(document, { button: 0 });
  act(() => jest.advanceTimersByTime(200));
  expect(catRows(container).map((r) => r.dataset.catrow)).toEqual(["work", "study", "exam", "diary"]);
  IpcSender.req.category.updateCategoryOrder.mockReset();
});

test("category menu renames with Enter, Esc leaves the field, colours save live", () => {
  const { container } = setup();
  const [work] = catRows(container);
  fireEvent.contextMenu(work);
  const menu = screen.getByRole("dialog", { name: "업무 카테고리 메뉴" });
  expect(work.classList.contains("menu-on")).toBe(true);
  fireEvent.click(within(menu).getByText("이름 바꾸기"));
  let field = within(menu).getByLabelText("카테고리 이름");
  fireEvent.change(field, { target: { value: "회사" } });
  fireEvent.keyDown(field, { key: "Escape" });
  expect(IpcSender.req.category.updateCategoryTitle).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "업무 카테고리 메뉴" })).toBeTruthy();
  fireEvent.click(within(menu).getByText("이름 바꾸기"));
  field = within(menu).getByLabelText("카테고리 이름");
  fireEvent.change(field, { target: { value: "  회사  " } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(IpcSender.req.category.updateCategoryTitle).toHaveBeenCalledWith("work", "회사", expect.any(Function));
  expect(screen.queryByRole("dialog", { name: "업무 카테고리 메뉴" })).toBeNull();

  fireEvent.contextMenu(work);
  const menu2 = screen.getByRole("dialog", { name: "업무 카테고리 메뉴" });
  fireEvent.click(within(menu2).getByRole("button", { name: "#44c98b" }));
  expect(IpcSender.req.category.updateCategoryColor).toHaveBeenCalledWith("work", "#44c98b", expect.any(Function));
  // The row shows the picked colour right away.
  expect(work.querySelector(".dot").style.background).toBe("rgb(68, 201, 139)");
  // Custom colour: hex field, low-contrast warning under 3:1 on #1a1e25.
  fireEvent.click(within(menu2).getByRole("button", { name: "직접 고르기" }));
  const hex = within(menu2).getByLabelText("색 코드");
  fireEvent.change(hex, { target: { value: "#202020" } });
  fireEvent.keyDown(hex, { key: "Enter" });
  expect(IpcSender.req.category.updateCategoryColor).toHaveBeenLastCalledWith("work", "#202020", expect.any(Function));
  expect(within(menu2).getByText("어두운 바탕에서 잘 안 보일 수 있어요.")).toBeTruthy();
  // Esc closes the menu.
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "업무 카테고리 메뉴" })).toBeNull();
});

test("the hue bar drag previews and saves once on release", () => {
  const { container } = setup();
  fireEvent.contextMenu(catRows(container)[0]);
  const menu = screen.getByRole("dialog", { name: "업무 카테고리 메뉴" });
  fireEvent.click(within(menu).getByRole("button", { name: "직접 고르기" }));
  const hue = within(menu).getByRole("slider", { name: "색상" });
  hue.getBoundingClientRect = () => ({ left: 0, top: 0, width: 180, height: 12 });
  fireEvent.pointerDown(hue, { button: 0, clientX: 0, clientY: 6 });
  fireEvent.pointerMove(window, { clientX: 60, clientY: 6 });
  fireEvent.pointerMove(window, { clientX: 90, clientY: 6 });
  expect(IpcSender.req.category.updateCategoryColor).not.toHaveBeenCalled();
  fireEvent.pointerUp(window, { clientX: 90, clientY: 6 });
  expect(IpcSender.req.category.updateCategoryColor).toHaveBeenCalledTimes(1);
});

test("deleting a category in use asks first, then takes it off its tasks", () => {
  const { container } = setup();
  fireEvent.contextMenu(catRows(container)[0]);
  fireEvent.click(screen.getByText("카테고리 삭제"));
  const dialog = screen.getByRole("alertdialog", { name: "'업무' 카테고리를 지울까요?" });
  // Done tasks count too: over, five, doneToday. "mixed" is also in the secret 일기, hidden
  // while the eye is off, so it is not counted (the number would give it away).
  expect(within(dialog).getByText("할 일 3개에서 빠져요. 할 일은 남아요.")).toBeTruthy();
  // The mock's delete: the trash tile (danger colour: jsdom drops var() colours), 취소 / 삭제.
  expect(dialog.querySelector(".tp-dialog-i svg")).toHaveAttribute("width", "26");
  expect(within(dialog).getByRole("button", { name: "삭제" })).toHaveClass("dp-btn", "danger");
  fireEvent.click(within(dialog).getByText("취소"));
  expect(IpcSender.req.category.deleteCategoryInUse).not.toHaveBeenCalled();
  fireEvent.contextMenu(catRows(container)[0]);
  fireEvent.click(screen.getByText("카테고리 삭제"));
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  expect(IpcSender.req.category.deleteCategoryInUse).toHaveBeenCalledWith("work", expect.any(Function));
  // An unused one: on E2EE the same in-use delete (a plain delete when nothing uses it).
  fireEvent.contextMenu(catRows(container)[2]);
  fireEvent.click(screen.getByText("카테고리 삭제"));
  expect(screen.getByText("이 카테고리를 쓰는 할 일은 없어요.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  expect(IpcSender.req.category.deleteCategoryInUse).toHaveBeenLastCalledWith("exam", expect.any(Function));
  expect(IpcSender.req.category.deleteCategory).not.toHaveBeenCalled();
});

test("a category used only by hidden secret tasks still deletes (the count stays what the screen shows)", () => {
  const { container } = setup({
    tasks: [task("hiddenOnly", { due: at(1, 9), cats: ["study", "diary"] })],
  });
  fireEvent.contextMenu(catRows(container)[1]);
  fireEvent.click(screen.getByText("카테고리 삭제"));
  // The hidden task is not counted (the number would give it away)...
  expect(screen.getByText("이 카테고리를 쓰는 할 일은 없어요.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  // ...but the delete takes the category off it first instead of failing with CATEGORY_IN_USE.
  expect(IpcSender.req.category.deleteCategoryInUse).toHaveBeenCalledWith("study", expect.any(Function));
  expect(IpcSender.req.category.deleteCategory).not.toHaveBeenCalled();
});

test("without E2EE an unused category is deleted plainly", () => {
  const { container } = setup({ syncStatus: { protocolVersion: 2, ready: true, connected: true } });
  fireEvent.contextMenu(catRows(container)[2]);
  fireEvent.click(screen.getByText("카테고리 삭제"));
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  expect(IpcSender.req.category.deleteCategory).toHaveBeenCalledWith("exam", expect.any(Function));
  expect(IpcSender.req.category.deleteCategoryInUse).not.toHaveBeenCalled();
});

const osVault = () =>
  IpcSender.vault.verifyUser.mockImplementation((input, cb) =>
    cb(
      input.method === "os"
        ? { success: true, data: { verified: true, method: "os" } }
        : { success: true, data: { verified: false, method: "password", code: "PASSWORD_REJECTED", osAvailable: true, passwordAvailable: true } }
    )
  );

test("deleting a secret category unlocks first and offers the two choices", async () => {
  osVault();
  const { container } = setup();
  fireEvent.contextMenu(catRows(container)[3]);
  fireEvent.click(screen.getByText("카테고리 삭제"));
  const hello = await screen.findByRole("alertdialog", { name: "비밀 카테고리를 볼까요?" });
  expect(within(hello).getByText(/Windows Hello로 본인 확인을 해요/)).toBeTruthy();
  await act(async () => fireEvent.click(within(hello).getByText("확인")));
  const dialog = await screen.findByRole("alertdialog", { name: "'일기' 카테고리를 지울까요?" });
  // Unlocked: both of its tasks count (secret, mixed).
  expect(within(dialog).getByText("할 일 2개에 쓰이고 있어요.")).toBeTruthy();
  expect(within(dialog).getByText("할 일 2개는 다른 화면에도 보여요")).toBeTruthy();
  // The mock's .cf-choices: 카테고리만 지우기 (blue), 할 일까지 지우기 (red, no second line), 취소.
  expect(within(dialog).getAllByRole("button").map((b) => [b.textContent, b.className])).toEqual([
    ["카테고리만 지우기할 일 2개는 다른 화면에도 보여요", "tp-dbtn pri"],
    ["할 일까지 지우기", "tp-dbtn danger"],
    ["취소", "tp-dbtn"],
  ]);
  fireEvent.click(within(dialog).getByText("할 일까지 지우기"));
  expect(IpcSender.req.category.deleteCategoryWithTasks).toHaveBeenCalledWith("diary", expect.any(Function));
  // Unlocked now: the other choice needs no second unlock.
  fireEvent.contextMenu(catRows(container)[3]);
  fireEvent.click(screen.getByText("카테고리 삭제"));
  fireEvent.click(await screen.findByText("카테고리만 지우기"));
  expect(IpcSender.req.category.deleteCategoryInUse).toHaveBeenCalledWith("diary", expect.any(Function));
  expect(IpcSender.vault.verifyUser).toHaveBeenCalledTimes(2);
});

test("clicking a locked secret category unlocks first; cancel keeps the current menu", async () => {
  osVault();
  const { container } = setup();
  const diary = catRows(container)[3];
  fireEvent.click(diary);
  const hello = await screen.findByRole("alertdialog", { name: "비밀 카테고리를 볼까요?" });
  await act(async () => fireEvent.click(within(hello).getByText("취소")));
  expect(setSelected).not.toHaveBeenCalled();
  fireEvent.click(diary);
  await act(async () => fireEvent.click(within(await screen.findByRole("alertdialog")).getByText("확인")));
  expect(setSelected).toHaveBeenCalledWith("diary");
  // Once per run.
  fireEvent.click(diary);
  await act(async () => {});
  expect(setSelected).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("the ＋ popup creates a category with the next unused colour and the secret flag", () => {
  const { container } = setup();
  fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
  const pop = screen.getByRole("dialog", { name: "새 카테고리" });
  const create = within(pop).getByText("만들기");
  expect(create).toBeDisabled();
  // #6294ff, #b58cff, #f0838b and #e57ad6 are taken: the next is #4fc3d9.
  expect(within(pop).getByRole("button", { name: "#4fc3d9" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(within(pop).getByLabelText("새 카테고리 이름"), { target: { value: "비밀 일" } });
  fireEvent.click(within(pop).getByRole("checkbox"));
  fireEvent.click(create);
  expect(IpcSender.req.category.createCategory).toHaveBeenCalledWith(
    expect.objectContaining({ title: "비밀 일", color: "#4fc3d9", secret: true }),
    expect.any(Function)
  );
  expect(screen.queryByRole("dialog", { name: "새 카테고리" })).toBeNull();
  // Enter creates too; Esc closes without creating.
  fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "새 카테고리" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
  const name = screen.getByLabelText("새 카테고리 이름");
  fireEvent.change(name, { target: { value: "운동" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(IpcSender.req.category.createCategory).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: "운동", color: "#4fc3d9", secret: false }),
    expect.any(Function)
  );
  expect(container.querySelector(".grp-add")).not.toBeNull();
});

test("account band: name and second line, the sync state as a dot on the photo, the settings gear", () => {
  const { container } = setup({ tasks: [], syncStatus: { ready: true, connected: true, syncing: true, pending: 2, error: null } });
  expect(container.querySelector(".foot .name").textContent).toBe("Jo");
  expect(container.querySelector(".foot .who small").textContent).toBeTruthy();
  const dot = container.querySelector(".foot .sync-dot");
  expect(dot).toHaveClass("syncing");
  expect(dot).toHaveAttribute("aria-label", "동기화 중…");
  expect(container.querySelector(".foot .av-w")).toHaveAttribute("data-tip", "동기화 중…");
  expect(screen.getByRole("button", { name: "설정" })).toHaveAttribute("data-tip", "설정");
  expect(container.querySelector("[title]")).toBeNull();
});

test("syncLine maps the sync-v2 status and the legacy nonces", () => {
  const base = { ready: true, connected: true, syncing: false, pending: 0, error: null };
  expect(syncLine(base).text).toBe("모두 동기화됨");
  expect(syncLine({ ...base, syncing: true }).text).toBe("동기화 중…");
  expect(syncLine({ ...base, connected: false }).text).toBe("오프라인");
  expect(syncLine({ ...base, error: "SYNC_UNAVAILABLE" }).text).toBe("동기화 오류");
  expect(syncLine(null, { offlineMode: true }).state).toBe("offline");
  expect(syncLine(null, { localNonce: 3, remoteNonce: 3 }).state).toBe("synced");
  expect(syncLine(null, { localNonce: 2, remoteNonce: 3 }).state).toBe("syncing");
});

const lift = (container, row = catRows(container)[0]) => {
  placeRows(container);
  fireEvent.mouseDown(row, { button: 0, clientX: 20, clientY: 110 });
  fireEvent.mouseMove(document, { clientX: 20, clientY: 180 });
};

test("the delete count follows the eye: hidden secret tasks are counted once shown", async () => {
  osVault();
  const { container } = setup();
  act(() => {
    session.setShowSecret(true);
  });
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByText("확인")));
  expect(session.showSecret).toBe(true);
  fireEvent.contextMenu(catRows(container)[0]);
  fireEvent.click(screen.getByText("카테고리 삭제"));
  // over, five, doneToday and now mixed (in 업무 and the secret 일기).
  expect(screen.getByText("할 일 4개에서 빠져요. 할 일은 남아요.")).toBeTruthy();
});

test("lifting a category closes every open popup, the list's menus and pickers too", () => {
  const onClose = jest.fn();
  const { container } = setup();
  render(<Popover anchor={{ x: 600, y: 200 }} role="menu" label="할 일 메뉴" onClose={onClose}>메뉴</Popover>);
  fireEvent.contextMenu(catRows(container)[1]);
  expect(screen.getByRole("dialog", { name: "공부 카테고리 메뉴" })).toBeTruthy();
  lift(container);
  expect(onClose).toHaveBeenCalledWith("dismiss");
  expect(screen.queryByRole("dialog", { name: "공부 카테고리 메뉴" })).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.mouseUp(document, { button: 0 });
});

test("unmounting while the ghost settles removes it and drops the move", () => {
  const { container, unmount } = setup();
  lift(container);
  fireEvent.mouseUp(document, { button: 0, clientX: 20, clientY: 180 });
  expect(document.querySelector(".cat-ghost")).not.toBeNull();
  unmount();
  expect(document.querySelector(".cat-ghost")).toBeNull();
  act(() => jest.advanceTimersByTime(500));
  expect(IpcSender.req.category.updateCategoryOrder).not.toHaveBeenCalled();
});

test("the app window losing focus cancels a lifted row", () => {
  const { container } = setup();
  lift(container);
  expect(document.querySelector(".cat-ghost")).not.toBeNull();
  act(() => window.dispatchEvent(new Event("blur")));
  expect(document.querySelector(".cat-ghost")).toBeNull();
  expect(catRows(container).every((r) => r.style.transform === "")).toBe(true);
  // The next plain click is not swallowed.
  fireEvent.click(catRows(container)[0]);
  expect(setSelected).toHaveBeenCalledWith("work");
});

test("without the E2EE order (legacy, plaintext v2) the rows are not offered for dragging", () => {
  const { container } = setup({ syncStatus: { ready: true, connected: true, syncing: false, pending: 0, error: null } });
  lift(container);
  expect(document.querySelector(".cat-ghost")).toBeNull();
  fireEvent.mouseUp(document, { button: 0 });
  fireEvent.click(catRows(container)[0]);
  expect(setSelected).toHaveBeenCalledWith("work");
});

test("an UNSUPPORTED order reply stops the drag for the run, with one toast", () => {
  IpcSender.req.category.updateCategoryOrder.mockImplementation((...args) => args[3]({ success: false, data: { code: "UNSUPPORTED_V2_ACTION" } }));
  const { container } = setup();
  lift(container);
  fireEvent.mouseUp(document, { button: 0 });
  act(() => jest.advanceTimersByTime(200));
  expect(Toast.warn).toHaveBeenCalledTimes(1);
  expect(Toast.warn).toHaveBeenCalledWith("이 계정에서는 카테고리 순서를 바꿀 수 없어요.");
  // The order is back and no row lifts any more.
  expect(catRows(container).map((r) => r.dataset.catrow)).toEqual(["work", "study", "exam", "diary"]);
  lift(container);
  expect(document.querySelector(".cat-ghost")).toBeNull();
  fireEvent.mouseUp(document, { button: 0 });
  act(() => jest.advanceTimersByTime(200));
  expect(IpcSender.req.category.updateCategoryOrder).toHaveBeenCalledTimes(1);
  expect(Toast.warn).toHaveBeenCalledTimes(1);
  IpcSender.req.category.updateCategoryOrder.mockReset();
});

test("two quick drops: the older reply does not end the newer order; the synced move does", () => {
  const replies = [];
  IpcSender.req.category.updateCategoryOrder.mockImplementation((...args) => replies.push(args[3]));
  const { container, rerender } = setup();
  const ids = () => catRows(container).map((r) => r.dataset.catrow);
  const drop = () => {
    lift(container);
    fireEvent.mouseUp(document, { button: 0 });
    act(() => jest.advanceTimersByTime(200));
  };
  const sync = (changes) => {
    const cats = { ...mockContext.states.categories };
    for (const [id, rank] of Object.entries(changes)) {
      const c = category(id, cats[id].title, cats[id].color, cats[id].secret, rank);
      cats[id] = c;
    }
    mockContext = { ...mockContext, states: { ...mockContext.states, categories: cats } };
    rerender(
      <SecretSessionProvider uid="fixture">
        <Grab />
        <LeftSidebar selectedTodoMenuType={TODO_MENU_TYPE.ALL} setSelectedTodoMenuType={setSelected} />
      </SecretSessionProvider>
    );
  };
  drop(); // 업무 two rows down: below 자격증
  expect(ids()).toEqual(["study", "exam", "work", "diary"]);
  drop(); // then 공부 two rows down: below 업무
  const second = ["exam", "work", "study", "diary"];
  expect(ids()).toEqual(second);
  // The reply to the first drop does not end the second one.
  act(() => replies[0]({ success: true }));
  expect(ids()).toEqual(second);
  // The state with the first move arrives: still the second order.
  sync({ work: "35" });
  expect(ids()).toEqual(second);
  // The state with the second move: the synced order has it, nothing left to show.
  sync({ study: "37" });
  expect(ids()).toEqual(second);
  act(() => replies[1]({ success: true }));
  // A later state (another device) is shown as it is.
  sync({ diary: "5" });
  expect(ids()).toEqual(["diary", "exam", "work", "study"]);
  IpcSender.req.category.updateCategoryOrder.mockReset();
});

test("a colour drag cut off by Esc saves nothing and the row keeps its colour", () => {
  const { container } = setup();
  const [work] = catRows(container);
  fireEvent.contextMenu(work);
  const menu = screen.getByRole("dialog", { name: "업무 카테고리 메뉴" });
  fireEvent.click(within(menu).getByRole("button", { name: "직접 고르기" }));
  const hue = within(menu).getByRole("slider", { name: "색상" });
  hue.getBoundingClientRect = () => ({ left: 0, top: 0, width: 180, height: 12 });
  fireEvent.pointerDown(hue, { button: 0, clientX: 0, clientY: 6 });
  fireEvent.pointerMove(window, { clientX: 90, clientY: 6 });
  expect(work.querySelector(".dot").style.background).not.toBe("rgb(98, 148, 255)");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "업무 카테고리 메뉴" })).toBeNull();
  fireEvent.pointerUp(window, { clientX: 90, clientY: 6 });
  expect(IpcSender.req.category.updateCategoryColor).not.toHaveBeenCalled();
  expect(work.querySelector(".dot").style.background).toBe("rgb(98, 148, 255)");
});

test("the colour sliders take the arrow keys and save on key-up", () => {
  const { container } = setup();
  fireEvent.contextMenu(catRows(container)[0]);
  const menu = screen.getByRole("dialog", { name: "업무 카테고리 메뉴" });
  fireEvent.click(within(menu).getByRole("button", { name: "직접 고르기" }));
  const hue = within(menu).getByRole("slider", { name: "색상" });
  expect(hue).toHaveAttribute("tabindex", "0");
  const before = Number(hue.getAttribute("aria-valuenow"));
  fireEvent.keyDown(hue, { key: "ArrowRight", shiftKey: true });
  fireEvent.keyDown(hue, { key: "ArrowRight" });
  expect(Number(hue.getAttribute("aria-valuenow"))).toBe(before + 11);
  expect(IpcSender.req.category.updateCategoryColor).not.toHaveBeenCalled();
  fireEvent.keyUp(hue, { key: "ArrowRight" });
  expect(IpcSender.req.category.updateCategoryColor).toHaveBeenCalledTimes(1);
});

test("menus mark the current one with aria-current; ＋ learns the unlock method for its line", () => {
  osVault();
  const { container } = setup({ selected: TODO_MENU_TYPE.TODAY });
  expect(navRow(container, TODO_MENU_TYPE.TODAY)).toHaveAttribute("aria-current", "page");
  expect(navRow(container, TODO_MENU_TYPE.ALL)).not.toHaveAttribute("aria-current");
  expect(navRow(container, TODO_MENU_TYPE.ALL)).not.toHaveAttribute("aria-pressed");
  fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
  expect(within(screen.getByRole("dialog", { name: "새 카테고리" })).getByText("열 때 Windows Hello로 확인해요")).toBeTruthy();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("while searching no menu row is the current one", () => {
  const { container } = setup({ selected: TODO_MENU_TYPE.TODAY, searchQuery: "리뷰" });
  expect(container.querySelector(".side-row.on")).toBeNull();
  expect(container.querySelector("[aria-current]")).toBeNull();
  const work = setup({ selected: "work", searchQuery: " 업무 " }).container;
  expect(work.querySelector(".cat-row.on")).toBeNull();
});
