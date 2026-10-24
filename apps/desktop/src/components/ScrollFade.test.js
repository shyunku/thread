import { fireEvent, render } from "@testing-library/react";
import ScrollFade from "./ScrollFade";

// jsdom has no layout: the scrolling element's sizes are set by hand.
const sized = (el, { scrollHeight, clientHeight, scrollTop = 0 }) => {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
  el.scrollTop = scrollTop;
};

test("the fade shows while there is more below and goes at the end", () => {
  const { container, rerender } = render(<div><div className="scroller" /><ScrollFade /></div>);
  const scroller = container.querySelector(".scroller"), fade = container.querySelector(".scroll-fade");
  expect(fade).not.toHaveClass("on");
  expect(fade).toHaveAttribute("aria-hidden", "true");
  sized(scroller, { scrollHeight: 1000, clientHeight: 400 });
  rerender(<div><div className="scroller" /><ScrollFade /></div>);
  expect(fade).toHaveClass("on");
  sized(scroller, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
  fireEvent.scroll(scroller);
  expect(fade).not.toHaveClass("on");
});
