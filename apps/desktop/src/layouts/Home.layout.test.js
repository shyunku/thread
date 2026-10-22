import { act, fireEvent, render, screen } from "@testing-library/react";
import HomeLayout from "./Home.layout";
import { PanelHost, SideMenuButton, layoutForWidth, useHomeLayout } from "./homeLayoutContext";

let mockContext;
let mockPanelWidth = null;
const mockDispatch = jest.fn();
let outlet;
jest.mock("react-router-dom", () => ({
  useOutletContext: () => mockContext,
  Outlet: ({ context }) => {
    outlet = context;
    return <MockMain />;
  },
}));
jest.mock("react-redux", () => ({
  useSelector: () => ({ uid: "fixture", username: "Jo", timeFormat: "12", panelWidth: mockPanelWidth }),
  useDispatch: () => mockDispatch,
}));
jest.mock("components/LeftSidebar", () => ({
  __esModule: true,
  default: ({ mode, setSelectedTodoMenuType }) => (
    <aside data-testid={`side-${mode}`}>
      <button className="side-row on" onClick={() => setSelectedTodoMenuType("오늘의 할일")}>오늘</button>
      <button className="side-row">중요</button>
    </aside>
  ),
}));
jest.mock("../utils/IpcSender", () => ({
  vault: { onLocked: () => () => {}, verifyUser: jest.fn() },
  onAll: jest.fn(),
  offAll: jest.fn(),
}));

function MockMain() {
  const { panelOpen, setPanelOpen } = useHomeLayout();
  return (
    <div>
      <SideMenuButton />
      <button onClick={() => setPanelOpen(true)}>panel</button>
      <PanelHost>
        <span>panel body {String(panelOpen)}</span>
        <button role="tab" aria-selected="true">tab</button>
        <button>last</button>
      </PanelHost>
    </div>
  );
}

const resize = (width) =>
  act(() => {
    window.innerWidth = width;
    window.dispatchEvent(new Event("resize"));
  });

beforeEach(() => {
  window.innerWidth = 1440;
  mockPanelWidth = null;
  mockDispatch.mockClear();
  mockContext = { states: { categories: {}, taskMap: {} }, searchQuery: "" };
});

test("layoutForWidth follows the mock breakpoints", () => {
  expect(layoutForWidth(1440)).toMatchObject({ mode: "full", rail: false, hideSide: false, overlayPanel: false, panelW: 360, sideW: 232 });
  expect(layoutForWidth(1280)).toMatchObject({ mode: "full", panelW: 360 });
  expect(layoutForWidth(1279)).toMatchObject({ mode: "rail", rail: true, overlayPanel: false, panelW: 320, sideW: 56 });
  expect(layoutForWidth(1000)).toMatchObject({ mode: "rail", overlayPanel: false });
  expect(layoutForWidth(999)).toMatchObject({ mode: "rail", overlayPanel: true });
  expect(layoutForWidth(800)).toMatchObject({ mode: "rail", hideSide: false });
  expect(layoutForWidth(799)).toMatchObject({ mode: "drawer", hideSide: true, overlayPanel: true, sideW: 0 });
});

test("layoutForWidth: a dragged panel width applies inline, shrinks to fit the window, not in the drawer", () => {
  expect(layoutForWidth(1440, null)).toMatchObject({ panelW: 360, panelDefault: 360, panelMax: 480 });
  expect(layoutForWidth(1440, 440)).toMatchObject({ panelW: 440 });
  // 1100 − 56 rail − 1 splitter − 560 list = 483 → the full 480 still fits.
  expect(layoutForWidth(1100, 480)).toMatchObject({ panelW: 480, panelMax: 480, panelDefault: 320 });
  // 1000 − 56 − 1 − 560 = 383: the stored width is kept in prefs but shown smaller.
  expect(layoutForWidth(1000, 480)).toMatchObject({ panelW: 383, panelMax: 383 });
  expect(layoutForWidth(1000, 340)).toMatchObject({ panelW: 340 });
  expect(layoutForWidth(1280, 480)).toMatchObject({ panelW: 480 });
  expect(layoutForWidth(960, 440)).toMatchObject({ overlayPanel: true, panelW: 320 });
  expect(layoutForWidth(1440, "wide")).toMatchObject({ panelW: 360 });
});

const panelEl = (container) => container.querySelector(".home-panel");
// jsdom has no PointerEvent; a MouseEvent of the pointer type carries clientX the same way.
const pointer = (type, el, clientX) =>
  fireEvent(el, new MouseEvent(type.replace(/^pointer(\w)/, (_, c) => "pointer" + c.toLowerCase()), { bubbles: true, cancelable: true, clientX, button: 0 }));

test("the splitter drag resizes the panel live and stores the width on release", () => {
  const { container } = render(<HomeLayout />);
  const splitter = screen.getByRole("separator", { name: "패널 너비" });
  expect(splitter).toHaveAttribute("data-tip", "끌어서 너비 조절");
  expect(splitter).toHaveAttribute("aria-valuenow", "360");
  expect(splitter).toHaveAttribute("aria-valuemax", "480");
  pointer("pointerDown", splitter, 1080);
  expect(document.body).toHaveClass("panel-resizing");
  pointer("pointerMove", splitter, 1020);
  expect(panelEl(container).style.width).toBe("420px");
  expect(mockDispatch).not.toHaveBeenCalled();
  // Bounded to 320–480.
  pointer("pointerMove", splitter, 200);
  expect(panelEl(container).style.width).toBe("480px");
  pointer("pointerMove", splitter, 1400);
  expect(panelEl(container).style.width).toBe("320px");
  pointer("pointerMove", splitter, 1040);
  pointer("pointerUp", splitter, 1040);
  expect(document.body).not.toHaveClass("panel-resizing");
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch).toHaveBeenCalledWith({ type: "prefs/setPrefs", payload: { panelWidth: 400 } });
  // Back to the stored width (the mock store did not take it).
  expect(panelEl(container).style.width).toBe("360px");

  // A press without a move stores nothing; double-click resets to the default.
  mockDispatch.mockClear();
  pointer("pointerDown", splitter, 1080);
  pointer("pointerUp", splitter, 1080);
  expect(mockDispatch).not.toHaveBeenCalled();
  fireEvent.doubleClick(splitter);
  expect(mockDispatch).toHaveBeenCalledWith({ type: "prefs/setPrefs", payload: { panelWidth: null } });

  // ← widens, → narrows by 16px while focused.
  mockDispatch.mockClear();
  fireEvent.keyDown(splitter, { key: "ArrowLeft" });
  expect(mockDispatch).toHaveBeenLastCalledWith({ type: "prefs/setPrefs", payload: { panelWidth: 376 } });
  fireEvent.keyDown(splitter, { key: "ArrowRight" });
  expect(mockDispatch).toHaveBeenLastCalledWith({ type: "prefs/setPrefs", payload: { panelWidth: 344 } });
});

test("a stored panel width is used and shrinks when the window cannot fit it", () => {
  mockPanelWidth = 470;
  const { container } = render(<HomeLayout />);
  expect(panelEl(container).style.width).toBe("470px");
  resize(1100);
  expect(panelEl(container).style.width).toBe("470px");
  resize(1000);
  expect(panelEl(container).style.width).toBe("383px");
  expect(screen.getByRole("separator", { name: "패널 너비" })).toHaveAttribute("aria-valuemax", "383");
  resize(1440);
  expect(panelEl(container).style.width).toBe("470px");
  // The drawer keeps its own width and has no splitter.
  resize(960);
  fireEvent.click(screen.getByText("panel"));
  expect(panelEl(container).style.width).toBe("320px");
  expect(screen.queryByRole("separator")).toBeNull();
});

test("the panel drawer is a modal dialog: focus goes in, Tab stays, and comes back", () => {
  window.innerWidth = 960;
  render(<HomeLayout />);
  const opener = screen.getByText("panel");
  opener.focus();
  fireEvent.click(opener);
  const drawer = screen.getByRole("dialog", { name: "패널" });
  expect(drawer).toHaveAttribute("aria-modal", "true");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "tab" }));
  fireEvent.keyDown(screen.getByText("last"), { key: "Tab" });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "tab" }));
  fireEvent.keyDown(document.activeElement, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(screen.getByText("last"));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "패널" })).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("the layout switches the sidebar mode and the panel host with the window width", () => {
  const { container } = render(<HomeLayout />);
  expect(screen.getByTestId("side-full")).toBeTruthy();
  expect(container.querySelector(".home-layout.full")).not.toBeNull();
  expect(container.querySelector(".home-panel:not(.drawer)").style.width).toBe("360px");
  expect(outlet.layout).toMatchObject({ mode: "full", panelW: 360 });
  expect(screen.queryByRole("button", { name: "메뉴" })).toBeNull();
  expect(container.querySelector(".sidebar-flipper")).toBeNull();

  resize(1180);
  expect(screen.getByTestId("side-rail")).toBeTruthy();
  expect(container.querySelector(".home-panel").style.width).toBe("320px");

  resize(960);
  expect(screen.getByTestId("side-rail")).toBeTruthy();
  // Overlay panel: closed until asked for, then a drawer over a scrim; Esc closes it.
  expect(container.querySelector(".home-panel")).toBeNull();
  fireEvent.click(screen.getByText("panel"));
  expect(container.querySelector(".home-panel.drawer")).not.toBeNull();
  expect(container.querySelector(".home-scrim")).not.toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(container.querySelector(".home-panel")).toBeNull();
  fireEvent.click(screen.getByText("panel"));
  fireEvent.mouseDown(container.querySelector(".home-scrim"));
  expect(container.querySelector(".home-panel")).toBeNull();

  resize(760);
  expect(screen.queryByTestId("side-rail")).toBeNull();
  expect(screen.queryByTestId("side-drawer")).toBeNull();
  // ☰ opens the drawer sidebar; Esc closes it; picking a menu closes it too.
  fireEvent.click(screen.getByRole("button", { name: "메뉴" }));
  expect(screen.getByTestId("side-drawer")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByTestId("side-drawer")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "메뉴" }));
  fireEvent.click(screen.getByText("오늘"));
  expect(screen.queryByTestId("side-drawer")).toBeNull();
  expect(outlet.selectedTodoMenuType).toBe("오늘의 할일");
  // Growing past 800px closes an open drawer.
  fireEvent.click(screen.getByRole("button", { name: "메뉴" }));
  resize(900);
  expect(screen.queryByTestId("side-drawer")).toBeNull();
  expect(screen.getByTestId("side-rail")).toBeTruthy();
});

test("the sidebar drawer is a modal dialog: focus goes in, Tab stays, and comes back to ☰", () => {
  window.innerWidth = 760;
  render(<HomeLayout />);
  const menuButton = screen.getByRole("button", { name: "메뉴" });
  expect(menuButton).toHaveAttribute("aria-expanded", "false");
  menuButton.focus();
  fireEvent.click(menuButton);
  const drawer = screen.getByRole("dialog", { name: "메뉴" });
  expect(drawer).toHaveAttribute("aria-modal", "true");
  expect(screen.getByRole("button", { name: "메뉴", expanded: true })).toBe(menuButton);
  // Focus starts on the current menu row.
  expect(document.activeElement).toBe(screen.getByText("오늘"));
  fireEvent.keyDown(screen.getByText("오늘"), { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(screen.getByText("중요"));
  fireEvent.keyDown(screen.getByText("중요"), { key: "Tab" });
  expect(document.activeElement).toBe(screen.getByText("오늘"));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "메뉴" })).toBeNull();
  expect(document.activeElement).toBe(menuButton);
});

test("the legacy category transitions are listened to by the layout, not the sidebar", () => {
  const IpcSender = require("../utils/IpcSender");
  const { unmount } = render(<HomeLayout />);
  expect(IpcSender.onAll).toHaveBeenCalledWith("category/createCategory", expect.any(Function));
  expect(IpcSender.onAll).toHaveBeenCalledWith("category/deleteCategory", expect.any(Function));
  unmount();
  expect(IpcSender.offAll).toHaveBeenCalledWith("category/createCategory");
});
