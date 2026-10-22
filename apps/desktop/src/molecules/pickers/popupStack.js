import { useLayoutEffect, useRef, useState } from "react";

// Open popups (menus, pickers, sidebar popups, dialogs) in opening order (#102). Esc goes to the
// top one only, and a press inside a popup above another one does not count as an outside press
// for it. Every popup of the main screen registers here, so they share one Esc / outside / z
// order.
const entries = [];
let seq = 0;

// The body gets this class while a popup is open: the title bar drops its window-drag region
// (TopBar.scss), so a press there reaches the page and closes the popup like anywhere else.
export const POPUP_OPEN_CLASS = "has-main-popup";

export const openPopupCount = () => entries.length;
const isTop = (entry) => entries[entries.length - 1] === entry;
const above = (entry) => entries.slice(entries.indexOf(entry) + 1);
const elementOf = (value) => (value && "current" in value ? value.current : value);

// Closes every popup that can be dismissed (menus, pickers, sidebar popups; not dialogs, which
// ask a question). For actions that start elsewhere, e.g. lifting a category in the sidebar.
export function closeAllPopups(reason = "dismiss") {
  [...entries].reverse().forEach((entry) => entry.latest.current.onDismiss?.(reason));
}

// After every open and close: the body class, and each popup's z-index by its place in the
// stack (its zBase + 2 per popup below it), so a popup opened later is always on top, even
// when several open in one render.
const restack = () => {
  if (typeof document !== "undefined") document.body.classList.toggle(POPUP_OPEN_CLASS, entries.length > 0);
  entries.forEach((entry, index) => {
    const el = entry.el(), base = entry.latest.current.zBase;
    if (el && base != null) el.style.zIndex = String(base + index * 2);
  });
};

// Registers the popup whose root is `ref` while it is mounted.
// - onEscape: Esc while it is the top popup. Esc from inside an element marked
//   [data-own-escape] is left to that element (e.g. an inline name field cancels itself).
// - onOutside: a mouse press outside it, outside popups above it and outside `ignore`
//   (elements or refs, e.g. the opener, so pressing the opener again can toggle it).
// - onDismiss: closeAllPopups() (and the window losing focus, for menus: `menu`).
// - zBase: the root's z-index base (Popover: POPOVER_Z, dialogs: DIALOG_Z).
export function usePopupLayer(ref, { onEscape, onOutside, onDismiss, ignore, menu = false, zBase } = {}) {
  const [order] = useState(() => ++seq);
  const latest = useRef({});
  latest.current = { onEscape, onOutside, onDismiss, ignore, zBase };

  useLayoutEffect(() => {
    const entry = { order, el: () => ref.current, latest };
    entries.push(entry);
    // Render order (parents first) decides, not effect order (children first).
    entries.sort((a, b) => a.order - b.order);
    restack();
    const onKey = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || !isTop(entry) || !latest.current.onEscape) return;
      const target = event.target;
      if (target instanceof Element && ref.current?.contains(target) && target.closest("[data-own-escape]")) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onEscape(event);
    };
    const onDown = (event) => {
      const target = event.target;
      if (!latest.current.onOutside || !(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      if (above(entry).some((e) => e.el()?.contains(target))) return;
      if ((latest.current.ignore || []).some((x) => elementOf(x)?.contains?.(target))) return;
      latest.current.onOutside(event);
    };
    // Like OS menus, a menu closes when the app window loses focus. Pickers keep their draft.
    const onBlur = () => latest.current.onDismiss?.("blur");
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    if (menu) window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
      if (menu) window.removeEventListener("blur", onBlur);
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
      restack();
    };
  }, [order, ref, menu]);
}
