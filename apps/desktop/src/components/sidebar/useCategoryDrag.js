import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { hideTooltip } from "../Tooltip";

export const LIFT_THRESHOLD = 4;
export const SETTLE_MS = 170;
export const SWALLOW_MS = 400;

// Category drag and drop in the sidebar (#102 mock): press a row and move 4px to lift it.
// A ghost aligned to the row follows the pointer (kept within the list), the other rows
// slide to open the slot, and on release the ghost settles into it before the order
// changes. Esc cancels; the click that ends a drag (or a cancelled one) is swallowed; no
// context menu, tooltip or text selection while a row is lifted. Rows are
// `.cat-row[data-catrow=<id>]` inside `rootRef`. onDrop(id, from, to) runs with the final
// index; onLift() closes open popups. enabled: false stops offering the drag (rows are plain
// buttons then). The app window losing focus cancels a lifted row; unmounting mid-drag or while
// the ghost settles removes the ghost and drops the move.
export default function useCategoryDrag(rootRef, { onDrop, onLift, enabled = true }) {
  const handlers = useRef({ onDrop, onLift, enabled });
  handlers.current = { onDrop, onLift, enabled };

  useEffect(() => {
    let drag = null,
      settled = null, // the drag whose ghost is settling into its slot
      settling = false,
      swallowNext = false,
      swallowUntil = 0,
      settleTimer = 0;
    const now = () => performance.now();

    const reset = (d) => {
      d.rows.forEach((el) => {
        el.style.transform = "";
        el.classList.remove("lifted");
      });
      d.root.classList.remove("sorting");
      d.ghost.remove();
    };
    const cancel = () => {
      if (!drag) return;
      if (drag.on) {
        reset(drag);
        swallowNext = true;
      }
      drag = null;
    };

    const onDown = (e) => {
      const root = rootRef.current;
      if (e.button !== 0 || settling || !root || !handlers.current.enabled) return;
      const row = e.target instanceof Element ? e.target.closest(".cat-row[data-catrow]") : null;
      if (!row || !root.contains(row)) return;
      // No text selection or focus ring from a press that may become a drag.
      e.preventDefault();
      drag = { id: row.dataset.catrow, x: e.clientX, y: e.clientY, row, on: false };
    };

    const onMove = (e) => {
      if (!drag) return;
      if (!drag.row.isConnected) return cancel();
      if (!drag.on) {
        if (Math.abs(e.clientY - drag.y) < LIFT_THRESHOLD && Math.abs(e.clientX - drag.x) < LIFT_THRESHOLD) return;
        const root = rootRef.current;
        const rows = [...root.querySelectorAll(".cat-row[data-catrow]")];
        const r = drag.row.getBoundingClientRect();
        drag.on = true;
        drag.root = root;
        drag.rows = rows;
        drag.from = rows.indexOf(drag.row);
        drag.to = drag.from;
        drag.h = rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top : r.height;
        if (!(drag.h > 0)) drag.h = r.height || 34;
        drag.top0 = r.top;
        drag.dy = drag.y - r.top;
        const ghost = drag.row.cloneNode(true);
        ghost.classList.add("cat-ghost", "main-scope");
        ghost.classList.toggle("in-rail", root.classList.contains("rail"));
        ghost.removeAttribute("data-tip");
        ghost.removeAttribute("tabindex");
        ghost.setAttribute("aria-hidden", "true");
        Object.assign(ghost.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
          transition: "none",
        });
        document.body.appendChild(ghost);
        drag.ghost = ghost;
        root.classList.add("sorting");
        drag.row.classList.add("lifted");
        hideTooltip();
        handlers.current.onLift?.();
      }
      const minTop = drag.top0 - drag.from * drag.h;
      const maxTop = minTop + (drag.rows.length - 1) * drag.h;
      const top = Math.max(minTop - 8, Math.min(maxTop + 8, e.clientY - drag.dy));
      drag.ghost.style.top = `${top}px`;
      drag.to = Math.max(0, Math.min(drag.rows.length - 1, Math.round((top - minTop) / drag.h)));
      const { from, to, h } = drag;
      drag.rows.forEach((el, i) => {
        if (el === drag.row) return;
        const shift = from < to && i > from && i <= to ? -h : from > to && i >= to && i < from ? h : 0;
        el.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    };

    const onUpCapture = (e) => {
      if (swallowNext && e.button === 0) {
        swallowNext = false;
        swallowUntil = now() + SWALLOW_MS;
      }
    };

    const onUp = (e) => {
      if (!drag || e.button !== 0) return;
      if (!drag.row.isConnected) {
        const on = drag.on;
        cancel();
        swallowNext = false;
        if (on) swallowUntil = now() + SWALLOW_MS;
        return;
      }
      const d = drag;
      drag = null;
      if (!d.on) return;
      swallowUntil = now() + SWALLOW_MS;
      // Settle the ghost into the slot, then reorder for real.
      d.ghost.style.transition = "";
      d.ghost.style.top = `${d.top0 + (d.to - d.from) * d.h}px`;
      settling = true;
      settled = d;
      settleTimer = setTimeout(() => {
        settling = false;
        settled = null;
        // Render the new order before the slide transforms come off, so rows do not jump.
        if (d.to !== d.from) flushSync(() => handlers.current.onDrop?.(d.id, d.from, d.to));
        reset(d);
      }, SETTLE_MS);
    };

    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (settling) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      if (drag) {
        const lifted = drag.on;
        cancel();
        if (lifted) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      }
    };

    const onContextMenu = (e) => {
      if (drag && drag.on) {
        e.preventDefault();
        e.stopImmediatePropagation();
      } else drag = null;
    };

    // Switching away from the app mid-drag: the release may never come back to this window.
    const onBlur = () => {
      cancel();
      swallowNext = false;
    };

    const onClick = (e) => {
      if (now() < swallowUntil) {
        swallowUntil = 0;
        e.stopPropagation();
        e.preventDefault();
      }
    };

    // Move and release in the capture phase: a popup stops its own events from bubbling.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUpCapture, true);
    document.addEventListener("mouseup", onUp, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("click", onClick, true);
    return () => {
      clearTimeout(settleTimer);
      if (settled) reset(settled);
      if (drag?.on) reset(drag);
      drag = settled = null;
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUpCapture, true);
      document.removeEventListener("mouseup", onUp, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [rootRef]);
}
