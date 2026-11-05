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
// A repeating list row that fell (#107) flashes where its next occurrence shows, if that comes
// within ROLL_WAIT (on the 오늘 screen it often does not: the next one is another day).
export const ROLL_WAIT = 3000;
const rolled = new Map(); // task id → until
// True once for a task whose completed row fell and whose next occurrence now shows (TaskRow).
export function takeRolled(id) {
  const until = rolled.get(id);
  rolled.delete(id);
  return until !== undefined && until >= Date.now();
}

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

// A fixed copy of the row in body that falls (completing) or rises (unchecking, #107) while the row
// closes. Returns the copy.
function leaveRow(row, kind) {
  const rect = row.getBoundingClientRect();
  const style = window.getComputedStyle(row), bg = style.backgroundColor;
  const copy = row.cloneNode(true);
  copy.classList.remove("rolled");
  copy.classList.add(kind, "main-scope");
  if (kind === "rise") {
    copy.classList.remove("done");
    const ck = copy.querySelector(".ck");
    ck?.classList.remove("done", "pop");
    ck?.setAttribute("aria-checked", "false");
  }
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
  return copy;
}
const isListRow = (row) => !!row?.isConnected && row.classList.contains("task-row");

// Returns complete(task, rowElement, done, stays). Tasks whose row stays where it is once done
// change at once after the pop (stays: the timeline with done tasks shown, #107), and so do
// repeating tasks outside the list; others animate first. A list row that is unchecked rises
// (#107), the opposite of the fall; a repeating list row falls too and its next occurrence
// flashes (takeRolled). `apply(task, done, onFailed)` sends the change, once per
// completion, and calls onFailed when the change was refused: the row then shows again (the
// caller tells the user). The timers are not tied to the row, so leaving the view mid-animation
// still completes the task.
export default function useTaskCompletion(apply) {
  const leaving = useRef(new Set());
  // One "show the row again" timer per task: a new completion or uncheck of the task drops the
  // one before, which would otherwise show the row in the middle of the new animation.
  const restores = useRef(new Map());
  const restoreLater = (task, row) => {
    clearTimeout(restores.current.get(task.id));
    restores.current.set(task.id, setTimeout(() => {
      restores.current.delete(task.id);
      restoreRow(row);
    }, RESTORE_AFTER));
  };
  const latest = useRef(apply);
  latest.current = apply;

  return useCallback((task, row, done = true, stays = false) => {
    if (leaving.current.has(task.id)) return;
    clearTimeout(restores.current.get(task.id));
    restores.current.delete(task.id);
    if (!done) {
      if (stays || !isListRow(row)) {
        latest.current(task, false);
        return;
      }
      leaving.current.add(task.id);
      const undo = () => {
        leaving.current.delete(task.id);
        latest.current(task, false, () => restoreRow(row));
        restoreLater(task, row);
      };
      if (reducedMotion()) {
        if (typeof row.animate === "function") row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_TIME, fill: "forwards" });
        setTimeout(undo, FADE_TIME);
        return;
      }
      setTimeout(() => {
        if (!row.isConnected) return undo();
        const copy = leaveRow(row, "rise");
        setTimeout(() => {
          copy.remove();
          undo();
        }, FALL_TIME);
      }, POP_DELAY);
      return;
    }
    leaving.current.add(task.id);
    const repeating = normalRepeat(task.repeatPeriod) !== null && dueMs(task.dueDate) !== null;
    // In the list a repeating task falls like the others and comes back as its next occurrence.
    const rolls = repeating && !stays && isListRow(row);
    const finish = () => {
      leaving.current.delete(task.id);
      if (rolls) rolled.set(task.id, Date.now() + ROLL_WAIT);
      latest.current(task, true, () => {
        rolled.delete(task.id);
        restoreRow(row);
      });
      restoreLater(task, row);
    };
    if (stays || !row?.isConnected || (repeating && !rolls)) {
      setTimeout(finish, repeating || stays ? REPEAT_POP : 0);
      return;
    }
    if (reducedMotion()) {
      if (typeof row.animate === "function") row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_TIME, fill: "forwards" });
      setTimeout(finish, FADE_TIME);
      return;
    }
    setTimeout(() => {
      if (!row.isConnected) return finish();
      const copy = leaveRow(row, "fall");
      setTimeout(() => {
        copy.remove();
        finish();
      }, FALL_TIME);
    }, POP_DELAY);
  }, []);
}
