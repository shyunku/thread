import { act, fireEvent, render, screen } from "@testing-library/react";
import Popover from "./Popover";

test("portals into body with the main-screen tokens and no global hover", () => {
  render(<Popover anchor={{ x: 10, y: 10 }} className="dp" label="창">내용</Popover>);
  const pop = screen.getByRole("dialog", { name: "창" });
  expect(pop.parentElement).toBe(document.body);
  expect(pop).toHaveClass("main-scope", "no-auto-hover", "tp-pop", "dp");
  expect(document.activeElement).toBe(pop);
});

test("Esc closes only the top popup", () => {
  const a = jest.fn(), b = jest.fn();
  render(
    <>
      <Popover anchor={{ x: 0, y: 0 }} label="A" onClose={a}>A</Popover>
      <Popover anchor={{ x: 0, y: 0 }} label="B" onClose={b}>B</Popover>
    </>
  );
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(b).toHaveBeenCalledWith("escape");
  expect(a).not.toHaveBeenCalled();
});

test("a nested popup counts as above its parent", () => {
  const outer = jest.fn(), inner = jest.fn();
  render(
    <Popover anchor={{ x: 0, y: 0 }} label="밖" onClose={outer}>
      <Popover anchor={{ x: 0, y: 0 }} label="안" onClose={inner}>안</Popover>
    </Popover>
  );
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(inner).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
  fireEvent.mouseDown(screen.getByText("안"));
  expect(outer).not.toHaveBeenCalled();
});

test("presses outside close it; inside, in a popup above, or on the anchor do not", () => {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const low = jest.fn(), high = jest.fn();
  render(
    <>
      <Popover anchor={anchor} label="아래" onClose={low}>아래</Popover>
      <Popover anchor={{ x: 0, y: 0 }} label="위" onClose={high}>위</Popover>
    </>
  );
  fireEvent.mouseDown(screen.getByText("아래"));
  expect(low).not.toHaveBeenCalled();
  expect(high).toHaveBeenCalledWith("outside");
  high.mockClear();
  fireEvent.mouseDown(screen.getByText("위"));
  expect(low).not.toHaveBeenCalled();
  expect(high).not.toHaveBeenCalled();
  fireEvent.mouseDown(anchor);
  expect(low).not.toHaveBeenCalled();
  fireEvent.mouseDown(document.body);
  expect(low).toHaveBeenCalledWith("outside");
  anchor.remove();
});

test("Esc inside [data-own-escape] is left to that element", () => {
  const onClose = jest.fn();
  render(<Popover anchor={{ x: 0, y: 0 }} onClose={onClose}><input aria-label="이름" data-own-escape="" /></Popover>);
  fireEvent.keyDown(screen.getByRole("textbox", { name: "이름" }), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("focus returns to the opener when it closes", () => {
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  opener.focus();
  const { unmount } = render(<Popover anchor={opener} label="창">내용</Popover>);
  expect(document.activeElement).toBe(screen.getByRole("dialog"));
  unmount();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

describe("one stack for the sidebar popups, the pickers and the dialogs", () => {
  // The sidebar popups are Popovers too (components/sidebar/CategoryPopups).
  const { SidebarPopup } = require("../../components/sidebar/CategoryPopups");
  const { closeAllPopups, openPopupCount, POPUP_OPEN_CLASS } = require("./popupStack");
  const ConfirmDialog = require("./ConfirmDialog").default;

  test("a picker over a sidebar popup: Esc, z order and presses follow the opening order", () => {
    const side = jest.fn(), picker = jest.fn();
    const { rerender } = render(
      <>
        <SidebarPopup anchor={{ top: 100, left: 240 }} label="업무 카테고리 메뉴" onClose={side}>메뉴</SidebarPopup>
        <Popover anchor={{ x: 400, y: 100 }} label="기한 정하기" onClose={picker}>날짜</Popover>
      </>
    );
    const sidePop = screen.getByRole("dialog", { name: "업무 카테고리 메뉴" });
    const pick = screen.getByRole("dialog", { name: "기한 정하기" });
    expect(Number(pick.style.zIndex)).toBeGreaterThan(Number(sidePop.style.zIndex));
    expect(document.body).toHaveClass(POPUP_OPEN_CLASS);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(picker).toHaveBeenCalledWith("escape");
    expect(side).not.toHaveBeenCalled();
    // A press in the picker (above) does not close the sidebar popup; one in the popup closes the picker.
    picker.mockClear();
    fireEvent.mouseDown(pick);
    expect(side).not.toHaveBeenCalled();
    fireEvent.mouseDown(sidePop);
    expect(picker).toHaveBeenCalledWith("outside");
    expect(side).not.toHaveBeenCalled();
    rerender(<></>);
    expect(openPopupCount()).toBe(0);
    expect(document.body).not.toHaveClass(POPUP_OPEN_CLASS);
  });

  test("a dialog sits above every popover and takes Esc; closeAllPopups leaves it open", () => {
    const pop = jest.fn(), cancel = jest.fn();
    render(
      <>
        <Popover anchor={{ x: 0, y: 0 }} label="메뉴" onClose={pop}>메뉴</Popover>
        <ConfirmDialog title="삭제할까요?" choices={[{ id: "delete", label: "삭제", danger: true }]} onChoose={() => {}} onCancel={cancel} />
        <Popover anchor={{ x: 0, y: 0 }} label="늦게 연 메뉴" onClose={pop}>늦게</Popover>
      </>
    );
    const wrap = document.querySelector(".tp-dialog-wrap");
    for (const el of screen.getAllByRole("dialog")) expect(Number(wrap.style.zIndex)).toBeGreaterThan(Number(el.style.zIndex));
    act(() => closeAllPopups());
    expect(pop).toHaveBeenCalledTimes(2);
    expect(pop).toHaveBeenCalledWith("dismiss");
    expect(cancel).not.toHaveBeenCalled();
  });

  test("Tab stays inside a picker; a menu closes on Tab and on window blur", () => {
    const onClose = jest.fn();
    const { unmount } = render(
      <Popover anchor={{ x: 0, y: 0 }} label="창" onClose={onClose}>
        <button>하나</button>
        <button>둘</button>
      </Popover>
    );
    const [one, two] = screen.getAllByRole("button");
    two.focus();
    fireEvent.keyDown(two, { key: "Tab" });
    expect(document.activeElement).toBe(one);
    fireEvent.keyDown(one, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(two);
    act(() => window.dispatchEvent(new Event("blur")));
    expect(onClose).not.toHaveBeenCalled();
    unmount();
    render(<Popover anchor={{ x: 0, y: 0 }} role="menu" label="메뉴" onClose={onClose}><button role="menuitem">열기</button></Popover>);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(onClose).toHaveBeenLastCalledWith("tab");
    act(() => window.dispatchEvent(new Event("blur")));
    expect(onClose).toHaveBeenLastCalledWith("blur");
  });
});

describe("placement over renders", () => {
  // jsdom has no layout: the size comes from data-h on the popup.
  const sizes = {};
  beforeAll(() => {
    sizes.h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    sizes.w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return Number(this.dataset?.h) || 0; } });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return this.dataset?.h ? 300 : 0; } });
  });
  afterAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", sizes.h);
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", sizes.w);
  });

  test("a popup that opened above its anchor stays above when it gets shorter", () => {
    window.innerHeight = 700;
    const anchor = { left: 100, right: 200, top: 400, bottom: 430 };
    const { rerender } = render(<Popover anchor={anchor} label="창" data-h="300">긴 내용</Popover>);
    const pop = screen.getByRole("dialog");
    expect(pop.style.top).toBe("94px");
    expect(pop).toHaveClass("flipped");
    // 100px tall would fit below now; it keeps its side, its bottom edge at the anchor.
    rerender(<Popover anchor={anchor} label="창" data-h="100">짧은 내용</Popover>);
    expect(pop.style.top).toBe("294px");
    expect(pop).toHaveClass("flipped");
    // A window resize places it afresh.
    act(() => window.dispatchEvent(new Event("resize")));
    expect(pop.style.top).toBe("436px");
    expect(pop).not.toHaveClass("flipped");
  });

  test("scrolling the page re-places an anchored popup; its own scrolling does not", () => {
    window.innerHeight = 700;
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    let top = 100;
    anchor.getBoundingClientRect = () => ({ left: 10, right: 60, top, bottom: top + 20, width: 50, height: 20 });
    render(<Popover anchor={anchor} label="창" data-h="100">내용</Popover>);
    const pop = screen.getByRole("dialog");
    expect(pop.style.top).toBe("126px");
    top = 50;
    fireEvent.scroll(pop);
    expect(pop.style.top).toBe("126px");
    fireEvent.scroll(document);
    expect(pop.style.top).toBe("76px");
    anchor.remove();
  });
});
