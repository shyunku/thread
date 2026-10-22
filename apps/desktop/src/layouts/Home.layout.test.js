import { act, fireEvent, render, screen } from "@testing-library/react";
import HomeLayout from "./Home.layout";
import { PanelHost, SideMenuButton, layoutForWidth, useHomeLayout } from "./homeLayoutContext";

let mockContext;
let outlet;
jest.mock("react-router-dom", () => ({
  useOutletContext: () => mockContext,
  Outlet: ({ context }) => {
    outlet = context;
    return <MockMain />;
  },
}));
jest.mock("react-redux", () => ({ useSelector: () => ({ uid: "fixture", username: "Jo", timeFormat: "12" }) }));
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
