import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { anchorRect, placePopover } from "./placement";
import { usePopupLayer } from "./popupStack";
import "./pickers.scss";

export const POPOVER_Z = 9000; // above the main screen and toasts, below the tooltip (20000)
export const DIALOG_Z = 9500; // dialogs sit above every popover

const FOCUSABLE = "button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex='-1'])";
const elementOf = (value) => (value && "current" in value ? value.current : value);
const isElement = (value) => value && typeof value.getBoundingClientRect === "function";

// React events bubble through portals to the React parents (a task row's click or Del key).
// A popup's own events stay inside it; the handler given by the caller still runs first.
export const stopEvents = (handlers = {}) => {
  const wrap = (fn) => (event) => { fn?.(event); event.stopPropagation(); };
  return {
    onClick: wrap(handlers.onClick),
    onMouseDown: wrap(handlers.onMouseDown),
    onContextMenu: wrap(handlers.onContextMenu),
    onKeyDown: wrap(handlers.onKeyDown),
  };
};

// Tab and Shift+Tab go round the focusable elements inside `root`.
export function trapTab(event, root) {
  if (event.key !== "Tab" || !root) return;
  const items = [...root.querySelectorAll(FOCUSABLE)];
  if (!items.length) { event.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1], active = document.activeElement;
  if (!root.contains(active) || active === root) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
  else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}

// A floating surface in document.body (#102): menus, pickers and the sidebar popups. It is the
// box itself (className gives its look) and, when too tall for the window, its own scroll
// container, so a sticky footer inside it stays in view. Placement follows placement.js and is
// redone after every render, when its content changes size, on window resize and on scroll,
// keeping the scroll position. A "bottom" popup keeps the side it first took (below or above)
// until the window is resized, so paging a month or filtering a list does not make it jump.
// Closes through onClose(reason): "escape" (top popup only), "outside" (a press outside;
// pressing the anchor element does not count, so its own click can toggle), "tab" (a menu
// left with Tab), "dismiss" (closeAllPopups) and "blur" (a menu when the window loses focus).
// Tab stays inside a non-menu popup. Focus moves into it when it opens (autoFocus) and back to
// the opener (or returnFocus) when it closes.
export default function Popover({
  anchor, placement = "bottom-start", gap = 6, offset, className = "", style, children, onClose,
  autoFocus = true, initialFocus, returnFocus, ignoreOutside, role = "dialog", label,
  onClick, onMouseDown, onContextMenu, onKeyDown, ...rest
}) {
  const ref = useRef(null);
  const [opener] = useState(() => (typeof document !== "undefined" ? document.activeElement : null));
  const latest = useRef({});
  latest.current = { anchor, placement, gap, offset };
  const side = useRef(null); // "bottom" | "top" once a bottom-* popup has been placed
  const menu = role === "menu";
  const anchorEl = isElement(elementOf(anchor)) ? elementOf(anchor) : null;
  usePopupLayer(ref, {
    onEscape: () => onClose?.("escape"),
    onOutside: () => onClose?.("outside"),
    onDismiss: (reason) => onClose?.(reason),
    ignore: [anchorEl, ...(ignoreOutside || [])],
    menu,
    zBase: POPOVER_Z,
  });

  const place = () => {
    const el = ref.current;
    if (!el) return;
    const { anchor: a, placement: wanted, gap: g, offset: o } = latest.current;
    const [first, align = "start"] = wanted.split("-");
    const kept = first === "bottom" && side.current;
    const p = kept === "top" ? `top-${align}` : wanted;
    const flip = kept !== "bottom";
    const keep = el.scrollTop;
    el.style.maxHeight = "";
    el.style.overflowY = "";
    el.style.width = "";
    const width = el.offsetWidth, height = el.offsetHeight;
    const view = { width: window.innerWidth, height: window.innerHeight };
    const rect = anchorRect(a);
    let pos = placePopover({ anchor: rect, size: { width, height }, view, placement: p, gap: g, offset: o, flip });
    if (pos.maxHeight !== null) {
      el.style.maxHeight = `${pos.maxHeight}px`;
      el.style.overflowY = "auto";
      // Widen by the scrollbar so the content keeps its width.
      const cs = window.getComputedStyle(el);
      const bar = el.offsetWidth - el.clientWidth - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0);
      if (bar > 0) {
        el.style.width = `${width + bar}px`;
        pos = placePopover({ anchor: rect, size: { width: width + bar, height }, view, placement: p, gap: g, offset: o, flip });
      }
    }
    if (first === "bottom" && !side.current) side.current = pos.flipped ? "top" : "bottom";
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    el.classList.toggle("flipped", kept === "top" || pos.flipped);
    el.scrollTop = keep;
  };

  useLayoutEffect(place);
  useEffect(() => {
    const el = ref.current;
    const onResize = () => { side.current = null; place(); };
    // Scrolling the page under an anchored popup moves the anchor; its own scrolling does not.
    const onScroll = (event) => { if (!(event.target instanceof Node && el?.contains(event.target))) place(); };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    // Content that changes size on its own (a section opening inside a child) re-places it,
    // in the next frame so the observer never loops within one.
    let frame = 0;
    const observer = typeof ResizeObserver !== "undefined" && el
      ? new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); })
      : null;
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
    // place reads the latest props through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (autoFocus) (elementOf(initialFocus) || ref.current)?.focus({ preventScroll: true });
    const root = ref.current;
    return () => {
      const active = document.activeElement;
      if (active && active !== document.body && !root?.contains(active)) return;
      const back = elementOf(returnFocus) || opener;
      if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
    };
    // Opening and closing only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keyDown = (event) => {
    onKeyDown?.(event);
    if (event.key !== "Tab" || event.defaultPrevented) return;
    if (menu) {
      // Menus close on Tab (focus goes back to the opener), like the WAI-ARIA menu pattern.
      event.preventDefault();
      onClose?.("tab");
    } else trapTab(event, ref.current);
  };

  return createPortal(
    <div
      ref={ref}
      className={`main-scope no-auto-hover tp-pop ${className}`}
      style={{ position: "fixed", left: 0, top: 0, ...style }}
      tabIndex={-1}
      role={role}
      aria-label={label}
      {...rest}
      {...stopEvents({ onClick, onMouseDown, onContextMenu, onKeyDown: keyDown })}
    >
      {children}
    </div>,
    document.body
  );
}
