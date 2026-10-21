import { act, fireEvent, render, screen } from "@testing-library/react";
import Tooltip, { TOOLTIP_DELAY, TooltipLayer, hideTooltip, placeTooltip } from "./Tooltip";

const tip = () => document.querySelector(".thread-tooltip");
const shown = () => tip().classList.contains("on");
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });

function setup(ui) {
  jest.useFakeTimers();
  const view = render(<><TooltipLayer />{ui}</>);
  return view;
}
const hover = (el) => fireEvent.mouseOver(el);

afterEach(() => jest.useRealTimers());

test("placement: below with an 8px gap, above near the window bottom, kept 4px inside the window", () => {
  const view = { width: 800, height: 600 };
  expect(placeTooltip(rect(100, 100, 40, 20), { width: 60, height: 26 }, view)).toEqual({ left: 90, top: 128, up: false });
  // 560 + 8 + 26 still fits above 600 - 4; 570 + 8 + 26 does not → above.
  expect(placeTooltip(rect(100, 540, 40, 20), { width: 60, height: 26 }, view)).toEqual({ left: 90, top: 568, up: false });
  expect(placeTooltip(rect(100, 550, 40, 20), { width: 60, height: 26 }, view)).toEqual({ left: 90, top: 516, up: true });
  expect(placeTooltip(rect(0, 10, 20, 20), { width: 80, height: 26 }, view).left).toBe(4);
  expect(placeTooltip(rect(780, 10, 20, 20), { width: 80, height: 26 }, view).left).toBe(716);
  // A tall element that fits neither below nor above: clamped to the window, never off the top.
  expect(placeTooltip(rect(100, 20, 40, 570), { width: 60, height: 26 }, view)).toEqual({ left: 90, top: 4, up: true });
  expect(placeTooltip(rect(100, -40, 40, 640), { width: 60, height: 26 }, view).top).toBe(4);
});

test("a [data-tip] element shows its tip after 250ms, under the element", () => {
  setup(<button data-tip="설정" aria-label="설정">⚙</button>);
  const button = screen.getByRole("button", { name: "설정" });
  button.getBoundingClientRect = () => rect(100, 100, 28, 28);
  hover(button);
  act(() => { jest.advanceTimersByTime(TOOLTIP_DELAY - 1); });
  expect(shown()).toBe(false);
  act(() => { jest.advanceTimersByTime(1); });
  expect(shown()).toBe(true);
  expect(tip()).toHaveTextContent("설정");
  expect(tip().style.top).toBe("136px");
  expect(tip()).not.toHaveClass("up");
  // Hidden from screen readers; the control keeps its own label.
  expect(tip()).toHaveAttribute("aria-hidden", "true");
});

test("flips above when the element is near the window bottom", () => {
  setup(<button data-tip="아래쪽">x</button>);
  const button = screen.getByText("x");
  button.getBoundingClientRect = () => rect(10, window.innerHeight - 30, 28, 28);
  hover(button);
  act(() => { jest.advanceTimersByTime(TOOLTIP_DELAY); });
  expect(tip()).toHaveClass("up", "on");
});

test("children of the element count; moving to another element restarts the delay; empty tips do nothing", () => {
  setup(<>
    <button data-tip="첫째"><span>a</span></button>
    <button data-tip="둘째">b</button>
    <button data-tip="">c</button>
  </>);
  hover(screen.getByText("a"));
  act(() => { jest.advanceTimersByTime(200); });
  hover(screen.getByText("b"));
  act(() => { jest.advanceTimersByTime(200); });
  expect(shown()).toBe(false);
  act(() => { jest.advanceTimersByTime(50); });
  expect(tip()).toHaveTextContent("둘째");
  hover(screen.getByText("c"));
  act(() => { jest.advanceTimersByTime(TOOLTIP_DELAY); });
  expect(shown()).toBe(false);
});

test("hides on mousedown, scroll, Escape, leaving the window and hideTooltip()", () => {
  setup(<div><button data-tip="팁">a</button><div data-testid="scroller" /></div>);
  const button = screen.getByText("a");
  const showAgain = () => {
    fireEvent.mouseOver(document.body);
    hover(button);
    act(() => { jest.advanceTimersByTime(TOOLTIP_DELAY); });
    expect(shown()).toBe(true);
  };
  showAgain();
  fireEvent.mouseDown(button);
  expect(shown()).toBe(false);
  showAgain();
  fireEvent.scroll(screen.getByTestId("scroller"));
  expect(shown()).toBe(false);
  showAgain();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(shown()).toBe(false);
  showAgain();
  fireEvent.mouseOut(button, { relatedTarget: null });
  expect(shown()).toBe(false);
  showAgain();
  act(() => hideTooltip());
  expect(shown()).toBe(false);
});

test("no tip while a mouse button is held, e.g. during a drag", () => {
  setup(<button data-tip="팁">a</button>);
  fireEvent.mouseOver(screen.getByText("a"), { buttons: 1 });
  act(() => { jest.advanceTimersByTime(TOOLTIP_DELAY); });
  expect(shown()).toBe(false);
});

test("a label that changes while shown updates; removing it hides the tip", async () => {
  const view = setup(<button data-tip="중요로 표시">★</button>);
  hover(screen.getByText("★"));
  act(() => { jest.advanceTimersByTime(TOOLTIP_DELAY); });
  view.rerender(<><TooltipLayer /><button data-tip="중요 해제">★</button></>);
  await act(async () => {});
  expect(tip()).toHaveTextContent("중요 해제");
  view.rerender(<><TooltipLayer /><button>★</button></>);
  await act(async () => {});
  expect(shown()).toBe(false);
});

test("removing the hovered element while the tip is shown hides it", async () => {
  const view = setup(<div><button data-tip="삭제될 행">a</button></div>);
  hover(screen.getByText("a"));
  act(() => { jest.advanceTimersByTime(TOOLTIP_DELAY); });
  expect(shown()).toBe(true);
  view.rerender(<><TooltipLayer /><div /></>);
  await act(async () => {});
  expect(shown()).toBe(false);
});

test("keyboard focus shows the tip after the delay; leaving focus hides it", () => {
  setup(<><button data-tip="설정">a</button><button>b</button></>);
  const button = screen.getByText("a");
  button.getBoundingClientRect = () => rect(100, 100, 28, 28);
  act(() => { button.focus(); });
  expect(shown()).toBe(false);
  act(() => { jest.advanceTimersByTime(TOOLTIP_DELAY); });
  expect(shown()).toBe(true);
  expect(tip()).toHaveTextContent("설정");
  act(() => { screen.getByText("b").focus(); });
  expect(shown()).toBe(false);
});

test("the Tooltip wrapper puts the label on its child without adding an element", () => {
  const { container } = render(<Tooltip label="닫기"><button aria-label="닫기">×</button></Tooltip>);
  expect(container.firstChild.tagName).toBe("BUTTON");
  expect(container.firstChild).toHaveAttribute("data-tip", "닫기");
});
