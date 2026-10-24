import "./viewParts.scss";
import { useLayoutEffect, useRef, useState } from "react";
import ListHeader from "components/list/ListHeader";
import { ChevIcon, NextIcon, PrevIcon, ShieldIcon } from "molecules/pickers/icons";
import { categoryColor } from "utils/categoryColors";
import { sortCategories } from "utils/categoryOrder";
import { dueMs } from "utils/timeDisplay";

// Shared pieces of the calendar and timeline views (#102).

export const WEEKDAYS = "일월화수목금토";

// Local midnight of a time, as ms.
export const dayStart = (value) => new Date(value).setHours(0, 0, 0, 0);
// `days` calendar days after a day (DST-safe), at midnight.
export const addDays = (value, days) => {
  const date = new Date(dayStart(value));
  date.setDate(date.getDate() + days);
  return date.getTime();
};

// Tasks with a due date by the local day they are due on: { midnightMs: [task] }.
// hideDone (완료한 할 일 숨기기) leaves the done ones out.
export function tasksByDay(taskMap, { hideDone = false } = {}) {
  const days = {};
  for (const task of Object.values(taskMap ?? {})) {
    const due = dueMs(task?.dueDate);
    if (due === null || (hideDone && task.done)) continue;
    const key = dayStart(due);
    if (!days[key]) days[key] = [];
    days[key].push(task);
  }
  return days;
}

// The task's categories to show, in sidebar order. `catsOf` (from TodoContent) already leaves out
// the secret ones that may not be named; without it every category of the task is used.
export function taskCategories(task, categories, catsOf) {
  if (catsOf) return catsOf(task) ?? [];
  const list = [];
  for (const cid of Object.keys(task?.categories ?? {})) {
    const category = categories?.[cid] ?? (typeof task.categories[cid] === "object" ? task.categories[cid] : null);
    if (category) list.push(category);
  }
  return sortCategories(list);
}

// The category to mark a task with: a secret one first (a secret task shows the shield), else
// the first.
export const markCategory = (cats) => cats.find((c) => c?.secret) ?? cats[0] ?? null;

// The dot in the category colour, or the shield for a secret category.
export function CategoryMark({ category, size = 12 }) {
  if (!category) return null;
  const color = categoryColor(category);
  return category.secret
    ? <span className="shield" style={{ color }} role="img" aria-label="비밀 카테고리"><ShieldIcon size={size} /></span>
    : <span className="dot" style={{ background: color }} />;
}

// The size of an element, following its resizes (ResizeObserver; window resizes otherwise).
export function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize((s) => (s.width === rect.width && s.height === rect.height ? s : { width: rect.width, height: rect.height }));
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);
  return size;
}

// ‹ 오늘 › after the title (mock headNav). The arrows get the click event, so a view can take a
// bigger step on Shift (a year, a week); prevTip/nextTip say so in the tooltip.
export function ViewNav({ prevLabel, nextLabel, prevTip = prevLabel, nextTip = nextLabel, onPrev, onToday, onNext }) {
  // Shift+press would also extend the text selection.
  const noSelect = (event) => { if (event.shiftKey) event.preventDefault(); };
  return (
    <span className="tc-nav" role="group" aria-label="이동">
      <button type="button" className="tc-ghost tc-sq" aria-label={prevLabel} data-tip={prevTip} onMouseDown={noSelect} onClick={onPrev}><PrevIcon /></button>
      <button type="button" className="tc-ghost" onClick={onToday}>오늘</button>
      <button type="button" className="tc-ghost tc-sq" aria-label={nextLabel} data-tip={nextTip} onMouseDown={noSelect} onClick={onNext}><NextIcon /></button>
    </span>
  );
}

// The view title as a button with a chevron (mock jumpTitle): it opens the jump popup that
// renderPopup({ anchor, close }) draws (a Popover anchored to the button). A second press on
// the title closes it. The tooltip is off while the popup is open, so it does not cover it.
export function JumpTitle({ title, tip, renderPopup }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return (
    <h1 className="tc-title tc-jump-h">
      <button
        ref={ref}
        type="button"
        className={"tc-jump" + (open ? " on" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tip={open ? undefined : tip}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="tc-jump-t">{title}</span>
        <span className="tc-jump-c"><ChevIcon /></span>
      </button>
      {open && renderPopup({ anchor: ref, close: () => setOpen(false) })}
    </h1>
  );
}

// The shared header (components/list/ListHeader) with the view's title, summary and ‹ 오늘 ›.
// `header` carries what TodoContent gives the list's header (view, onView, prefs, onPref,
// extra); without it only the title row and the summary are drawn. `heading` replaces the
// plain title (JumpTitle).
export function ViewHeader({ header, title, summary, nav, heading }) {
  if (header) return <ListHeader {...header} title={title} summary={summary} nav={nav} heading={heading} />;
  return (
    <div className="tc-head">
      <div className="tc-row1">
        {heading ?? <h1 className="tc-title">{title}</h1>}
        {nav}
        <span className="tc-push" />
      </div>
      <p className="tc-finding">{summary}</p>
    </div>
  );
}
