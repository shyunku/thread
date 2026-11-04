import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { hideTooltip } from "../Tooltip";
import { LIFT_THRESHOLD, SETTLE_MS, SWALLOW_MS } from "../sidebar/useCategoryDrag";

const ROW = ".rp-subt[data-subtask-id]";

// Subtask drag and drop in the detail panel (#106 mock, like the sidebar's useCategoryDrag):
// press a row's grip (.sgrip) and move 4px to lift it. A ghost of the row follows the pointer
// (kept within the list), the other rows slide to open the slot, and on release the ghost
// settles into it before the order changes. Esc cancels; the click that ends a drag is
// swallowed; no context menu or tooltip while a row is lifted. The ghost is placed inside
// `rootRef` (the .rp-subs box, position: relative), so it keeps the panel's row styles and
// scrolls with the panel. onDrop(id, from, to) runs with the final index; onLift() closes
// open pickers. enabled: false stops offering the drag. The window losing focus cancels a
// lifted row; unmounting mid-drag or while the ghost settles removes the ghost and drops the move.
export default function useSubtaskDrag(rootRef, { onDrop, onLift, enabled = true }) {
  const handlers = useRef({ onDrop, onLift, enabled });
  handlers.current = { onDrop, onLift, enabled };

  useEffect(() => {
    let drag = null,
      settled = null,
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
      const grip = e.target instanceof Element ? e.target.closest(".sgrip") : null;
      const row = grip?.closest(ROW);
      if (!row || !root.contains(row)) return;
      // No text selection or focus change from a press on the grip.
      e.preventDefault();
      drag = { id: row.dataset.subtaskId, x: e.clientX, y: e.clientY, row, on: false };
    };

    const onMove = (e) => {
      if (!drag) return;
      if (!drag.row.isConnected) return cancel();
      if (!drag.on) {
        if (Math.abs(e.clientY - drag.y) < LIFT_THRESHOLD && Math.abs(e.clientX - drag.x) < LIFT_THRESHOLD) return;
        const root = rootRef.current;
        const rows = [...root.querySelectorAll(ROW)];
        const box = root.getBoundingClientRect();
        const r = drag.row.getBoundingClientRect();
        drag.on = true;
        drag.root = root;
        drag.rows = rows;
        drag.from = rows.indexOf(drag.row);
        drag.to = drag.from;
        drag.h = rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top : r.height;
        if (!(drag.h > 0)) drag.h = r.height || 36;
        // Ghost positions are relative to the box.
        drag.top0 = r.top - box.top;
        const ghost = drag.row.cloneNode(true);
        ghost.classList.add("sub-ghost");
        ghost.classList.remove("hov", "lifted");
        ghost.removeAttribute("data-subtask-id");
        ghost.querySelectorAll("[data-tip]").forEach((el) => el.removeAttribute("data-tip"));
        ghost.querySelectorAll("button, input").forEach((el) => el.setAttribute("tabindex", "-1"));
        ghost.setAttribute("aria-hidden", "true");
        Object.assign(ghost.style, {
          left: `${r.left - box.left}px`,
          top: `${drag.top0}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
          transition: "none",
        });
        // First in the box, so the rows' :first-child / :last-child / + rules stay as they are.
        root.prepend(ghost);
        drag.ghost = ghost;
        root.classList.add("sorting");
        drag.row.classList.add("lifted");
        hideTooltip();
        handlers.current.onLift?.();
      }
      const minTop = drag.top0 - drag.from * drag.h;
      const maxTop = minTop + (drag.rows.length - 1) * drag.h;
      const top = Math.max(minTop - 4, Math.min(maxTop + 4, drag.top0 + e.clientY - drag.y));
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
