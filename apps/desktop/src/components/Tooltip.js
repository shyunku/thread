import { Children, cloneElement, isValidElement, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./Tooltip.scss";

// One shared tooltip for the whole window (#102). Any element with a non-empty `data-tip`
// gets it: shown 250ms after the pointer rests on it or keyboard focus reaches it, under the
// element (above it when it would cross the window bottom), kept inside the window.
// Mount <TooltipLayer/> once.
export const TOOLTIP_DELAY = 250;
const GAP = 8; // between the element and the tip
const EDGE = 4; // minimum distance from the window edges
const HIDE_EVENT = "thread:tooltip-hide";

// Hides the tip now, e.g. when a drag starts.
export function hideTooltip() {
  window.dispatchEvent(new Event(HIDE_EVENT));
}

// Where the tip goes for an element rect, a tip size and the window size.
export function placeTooltip(rect, size, view) {
  const up = rect.bottom + GAP + size.height > view.height - EDGE;
  const centred = rect.left + rect.width / 2 - size.width / 2;
  const left = Math.max(EDGE, Math.min(view.width - size.width - EDGE, centred));
  const side = up ? rect.top - GAP - size.height : rect.bottom + GAP;
  // A tall element near the top fits neither way; keep the tip inside the window anyway.
  const top = Math.max(EDGE, Math.min(view.height - size.height - EDGE, side));
  return { left, top, up };
}

function focusVisible(el) {
  try { return el.matches(":focus-visible"); } catch { return false; }
}

export function TooltipLayer() {
  const tipRef = useRef(null);

  useEffect(() => {
    const tip = tipRef.current;
    let target = null, timer = 0, observer = null;

    const hide = () => {
      clearTimeout(timer);
      observer?.disconnect();
      observer = null;
      target = null;
      tip.classList.remove("on");
    };
    const place = () => {
      if (!target) return;
      const { left, top, up } = placeTooltip(target.getBoundingClientRect(),
        { width: tip.offsetWidth, height: tip.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight });
      tip.classList.toggle("up", up);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    const show = () => {
      if (!target?.isConnected) return hide();
      tip.textContent = target.dataset.tip;
      place();
      tip.classList.add("on");
      // Labels that change while shown (e.g. 중요로 표시 → 중요 해제) update in place; a target that
      // is removed or re-mounted (row deleted, sync re-render, regrouping) takes the tip with it.
      observer = new MutationObserver(() => {
        if (!target?.isConnected || !target.dataset.tip) return hide();
        // Only on a real change: the tip lives in body too, so rewriting it would re-trigger this.
        if (tip.textContent !== target.dataset.tip) tip.textContent = target.dataset.tip;
        place();
      });
      observer.observe(target, { attributes: true, attributeFilter: ["data-tip"] });
      observer.observe(document.body, { childList: true, subtree: true });
    };
    const schedule = (el) => {
      target = el;
      timer = setTimeout(show, TOOLTIP_DELAY);
    };
    const onOver = (event) => {
      const el = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
      if (el === target) return;
      hide();
      // No tips while a button is held (drags, selections).
      if (!el || !el.dataset.tip || event.buttons) return;
      schedule(el);
    };
    // Keyboard focus shows the tip as hover does (the old tooltip used :focus-within). A mouse
    // click on a button is not :focus-visible, so clicks do not bring the tip back.
    const onFocusIn = (event) => {
      const el = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
      if (!el || !el.dataset.tip || el === target || !focusVisible(event.target)) return;
      hide();
      schedule(el);
    };
    const onFocusOut = (event) => {
      if (target && target.contains(event.target) && !target.contains(event.relatedTarget)) hide();
    };
    // Leaving the window or the document.
    const onOut = (event) => { if (!event.relatedTarget) hide(); };
    const onKey = (event) => { if (event.key === "Escape") hide(); };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("wheel", hide, { capture: true, passive: true });
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    window.addEventListener(HIDE_EVENT, hide);
    return () => {
      hide();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("wheel", hide, { capture: true });
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
      window.removeEventListener(HIDE_EVENT, hide);
    };
  }, []);

  // Screen readers keep using each control's own aria-label, so the tip itself is hidden from them.
  return createPortal(<div ref={tipRef} className="thread-tooltip" aria-hidden="true" />, document.body);
}

// Convenience wrapper: <Tooltip label="설정"><button aria-label="설정">…</button></Tooltip>
// puts the label on the child as data-tip. Adds no element of its own.
export default function Tooltip({ label, children }) {
  const child = Children.only(children);
  return isValidElement(child) ? cloneElement(child, { "data-tip": label || undefined }) : child;
}
