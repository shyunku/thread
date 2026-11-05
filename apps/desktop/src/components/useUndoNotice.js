import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPopupCount } from "molecules/pickers";

// The undo notice (#107.11, mock .undo-toast): one at a time; a new action replaces it (the one
// before can no longer be undone). It leaves after NOTICE_TIME, right after an undo, and when the
// user unchecks the very task or subtask it says was completed. LEAVE_TIME is its way out.
export const NOTICE_TIME = 5000;
export const LEAVE_TIME = 160;

const isEditable = (el) =>
  el instanceof Element && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
// Ctrl+Z (Meta+Z on macOS); the code also matches the Korean layout.
const isUndoKey = (event) =>
  (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey &&
  (event.code === "KeyZ" || event.key?.toLowerCase() === "z");

// Returns { notice, show, undo, dismissDone, clear }.
// - show({ kind: "done" | "add" | "del", name, target: { tid, sid }, secret, undo }) shows it for
//   a change just sent and returns settle(ok) for that change's answer: a refused change takes
//   the notice away, and an undo pressed before the answer waits for it (it runs only once the
//   change went through). Without `undo` the notice has no 되돌리기.
// - undo() takes the shown change back, once.
// - dismissDone(tid, sid) lets it go when that task (or subtask) is unchecked by hand.
// - clear(which, { cancel }) drops it at once, without the way out (the lock closed, another
//   vault); with cancel (the default) an undo still waiting for its change's answer never runs.
export default function useUndoNotice() {
  const [notice, setNotice] = useState(null); // { seq, kind, name, canUndo, leaving }
  const entry = useRef(null);
  const timer = useRef(null);
  const seq = useRef(0);
  // Undos pressed before their change was answered (they run once it is).
  const waiting = useRef(new Set());
  const cancelWaiting = useCallback(() => {
    waiting.current.forEach((e) => { e.wanted = false; });
    waiting.current.clear();
  }, []);

  const drop = useCallback(() => {
    clearTimeout(timer.current);
    entry.current = null;
    setNotice(null);
  }, []);
  const leave = useCallback((e) => {
    if (entry.current !== e || e.leaving) return;
    e.leaving = true;
    clearTimeout(timer.current);
    setNotice((n) => (n?.seq === e.seq ? { ...n, leaving: true } : n));
    timer.current = setTimeout(() => entry.current === e && drop(), LEAVE_TIME);
  }, [drop]);

  const show = useCallback(({ kind, name, target = {}, secret = false, undo = null }) => {
    clearTimeout(timer.current);
    const e = { seq: ++seq.current, kind, target, secret, undo, ok: false, wanted: false, used: false, leaving: false };
    entry.current = e;
    setNotice({ seq: e.seq, kind, name: name ?? "", canUndo: !!undo, leaving: false });
    timer.current = setTimeout(() => leave(e), NOTICE_TIME);
    return (ok) => {
      waiting.current.delete(e);
      if (!ok) {
        e.wanted = false;
        if (entry.current === e) drop();
        return;
      }
      e.ok = true;
      if (e.wanted) {
        e.wanted = false;
        e.undo();
      }
    };
  }, [leave, drop]);

  const undo = useCallback(() => {
    const e = entry.current;
    if (!e || e.leaving || e.used || !e.undo) return;
    e.used = true;
    if (e.ok) e.undo();
    else {
      e.wanted = true;
      waiting.current.add(e);
    }
    leave(e);
  }, [leave]);

  const dismissDone = useCallback((tid, sid = null) => {
    const e = entry.current;
    if (e?.kind === "done" && e.target.tid === tid && (e.target.sid ?? null) === sid) leave(e);
  }, [leave]);

  const clear = useCallback((which, { cancel = true } = {}) => {
    if (cancel) cancelWaiting();
    const e = entry.current;
    if (e && (!which || which(e))) drop();
  }, [drop, cancelWaiting]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    cancelWaiting();
  }, [cancelWaiting]);

  // Ctrl+Z while it can be undone; text fields keep their own undo, and an open popup, dialog or
  // modal keeps the keys.
  const armed = !!notice && notice.canUndo && !notice.leaving;
  useEffect(() => {
    if (!armed) return undefined;
    const onKey = (event) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || !isUndoKey(event)) return;
      if (isEditable(event.target) || isEditable(document.activeElement)) return;
      if (openPopupCount() > 0 || document.querySelector(".modal.active")) return;
      event.preventDefault();
      undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [armed, undo]);

  return useMemo(() => ({ notice, show, undo, dismissDone, clear }), [notice, show, undo, dismissDone, clear]);
}
