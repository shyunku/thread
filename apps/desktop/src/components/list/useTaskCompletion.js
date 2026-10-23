import { useCallback, useRef } from "react";
import { normalRepeat } from "utils/repeatRule";
import { dueMs } from "utils/timeDisplay";

// Completion timing (#102 mock :1241-1260, confirmed): the check pops first; after POP_DELAY a
// fixed copy of the row falls 80px over 408ms while the row closes in 153ms; the task flips to
// done FALL_TIME later. Reduced motion: the row only fades (FADE_TIME).
export const POP_DELAY = 136;
export const FALL_TIME = 425;
export const FADE_TIME = 200;
// A repeating task stays in the list with its next due, so it does not fall: the check pops and
// the task rolls forward when the pop is over.
export const REPEAT_POP = 220;
// A change that never answers: the row shows again after this, if it is still on screen.
export const RESTORE_AFTER = 10000;

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const nextFrame = (fn) => (typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(fn) : setTimeout(fn, 16));

// Shows a row hidden by the completion again (the fade, the collapse).
export function restoreRow(row) {
  if (!row?.isConnected) return;
  if (!row.classList.contains("closing") && !row.style.visibility && !row.style.height && !row.getAnimations?.().length) return;
  row.getAnimations?.().forEach((a) => a.cancel());
  row.classList.remove("closing");
  row.style.visibility = "";
  row.style.height = "";
}

// Returns complete(task, rowElement, done). Undone and repeating tasks change at once (after the
// pop); others animate first. `apply(task, done, onFailed)` sends the change, once per
// completion, and calls onFailed when the change was refused: the row then shows again (the
// caller tells the user). The timers are not tied to the row, so leaving the view mid-animation
// still completes the task.
export default function useTaskCompletion(apply) {
  const leaving = useRef(new Set());
  const latest = useRef(apply);
  latest.current = apply;

  return useCallback((task, row, done = true) => {
    if (!done) {
      latest.current(task, false);
      return;
    }
    if (leaving.current.has(task.id)) return;
    leaving.current.add(task.id);
    const finish = () => {
      leaving.current.delete(task.id);
      latest.current(task, true, () => restoreRow(row));
      setTimeout(() => restoreRow(row), RESTORE_AFTER);
    };
    const repeating = normalRepeat(task.repeatPeriod) !== null && dueMs(task.dueDate) !== null;
    if (repeating || !row?.isConnected) {
      setTimeout(finish, repeating ? REPEAT_POP : 0);
      return;
    }
    if (reducedMotion()) {
      if (typeof row.animate === "function") row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_TIME, fill: "forwards" });
      setTimeout(finish, FADE_TIME);
      return;
    }
    setTimeout(() => {
      if (!row.isConnected) return finish();
      const rect = row.getBoundingClientRect();
      const style = window.getComputedStyle(row), bg = style.backgroundColor;
      const copy = row.cloneNode(true);
      copy.classList.add("fall", "main-scope");
      copy.setAttribute("aria-hidden", "true");
      copy.removeAttribute("tabindex");
      Object.assign(copy.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        background: !bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent" ? "var(--raise)" : bg,
        // The copy lives in body, outside the list that sets the row spacing.
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      });
      document.body.appendChild(copy);
      row.style.visibility = "hidden";
      row.style.height = `${row.offsetHeight}px`;
      nextFrame(() => {
        row.classList.add("closing");
        row.style.height = "0px";
      });
      setTimeout(() => {
        copy.remove();
        finish();
      }, FALL_TIME);
    }, POP_DELAY);
  }, []);
}
