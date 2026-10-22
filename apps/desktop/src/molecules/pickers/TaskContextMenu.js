import { useRef, useState } from "react";
import { categoryColor } from "utils/categoryColors";
import { dueMs } from "utils/timeDisplay";
import DatePicker from "./DatePicker";
import {
  CalendarIcon, ClearIcon, CopyIcon, DayLaterIcon, NextIcon, OpenIcon, PlusIcon, ShieldIcon,
  StarIcon, SunIcon, TagIcon, TickIcon, TrashIcon, WeekIcon, WeekLaterIcon,
} from "./icons";
import Popover from "./Popover";

// The due a 기한 item gives. 오늘 / 내일 keep the time of day of the current due (no due: the
// end of the day); 하루 미루기 / 일주일 미루기 move the due by calendar days, keeping the time.
export function menuDue(kind, due, now = Date.now()) {
  const has = dueMs(due) !== null;
  if (kind === "today" || kind === "tomorrow") {
    const d = new Date(now);
    if (has) { const t = new Date(due); d.setHours(t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()); }
    else d.setHours(23, 59, 59, 0);
    if (kind === "tomorrow") d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if ((kind === "plus1" || kind === "plus7") && has) {
    const d = new Date(due);
    d.setDate(d.getDate() + (kind === "plus1" ? 1 : 7));
    return d.getTime();
  }
  return null;
}

const Item = ({ icon, label, hint, danger, onClick, itemRef, onEnter, ...rest }) => (
  <button
    ref={itemRef}
    type="button"
    role="menuitem"
    tabIndex={-1}
    className={`tp-mi${danger ? " danger" : ""}`}
    onClick={onClick}
    onMouseEnter={onEnter}
    {...rest}
  >
    <span className="tp-mic">{icon}</span>
    <span className="tp-lb">{label}</span>
    {hint && <span className="tp-kb">{hint}</span>}
  </button>
);

// Right-click menu of a task (#102 mock contextMenu), opened at the pointer (point {x, y}).
// No IPC inside: every action is a callback, and the menu closes after it (onClose), except the
// category ticks, which keep the submenu open. 날짜 · 시간 정하기… swaps the menu for the date
// picker at the same place; 정하기 there calls onSetDue(ms).
// due: ms or null; important: boolean; categoryIds: the task's categories;
// categories: [{ id, title, color, secret }] in display order.
// Callbacks: onOpen, onSetDue(ms | null), onToggleImportant, onToggleCategory(id),
// onNewCategory, onDuplicate, onDelete (the caller confirms), onClose.
export default function TaskContextMenu({
  point, due = null, important = false, categoryIds = [], categories = [],
  now, timeFormat, weekStart,
  onOpen, onSetDue, onToggleImportant, onToggleCategory, onNewCategory, onDuplicate, onDelete, onClose,
}) {
  const [mode, setMode] = useState("menu");
  const [sub, setSub] = useState(null); // null | "hover" | "keyboard"
  const [opener] = useState(() => document.activeElement);
  const menuRef = useRef(null);
  const subItemRef = useRef(null);
  const subRef = useRef(null);
  const dueAt = dueMs(due);
  const hasDue = dueAt !== null;
  const assigned = new Set(categoryIds);

  const close = () => onClose?.();
  const act = (fn) => () => { fn?.(); close(); };
  const setDue = (kind) => act(() => onSetDue?.(menuDue(kind, due, now ?? Date.now())));
  const others = { onEnter: () => setSub(null) };

  const items = () => [...(menuRef.current?.querySelectorAll(":scope > .tp-mi") || [])];
  const onMenuKey = (event) => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = index < 0 ? (step > 0 ? 0 : list.length - 1) : (index + step + list.length) % list.length;
      list[next]?.focus();
      if (list[next] !== subItemRef.current) setSub(null);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      list[event.key === "Home" ? 0 : list.length - 1]?.focus();
    } else if (event.key === "ArrowRight" && document.activeElement === subItemRef.current) {
      event.preventDefault();
      setSub("keyboard");
    } else if (event.key === "Delete" && onDelete) {
      event.preventDefault();
      act(onDelete)();
    } else if (event.key === "Enter" && event.target === event.currentTarget && onOpen) {
      // The menu itself has focus when it opens: Enter is 열기, as its hint says.
      event.preventDefault();
      act(onOpen)();
    }
  };
  const onSubKey = (event) => {
    const list = [...(subRef.current?.querySelectorAll(".tp-mi") || [])];
    const index = list.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[index < 0 ? (step > 0 ? 0 : list.length - 1) : (index + step + list.length) % list.length]?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSub(null);
      subItemRef.current?.focus();
    }
  };

  if (mode === "date") {
    return (
      <DatePicker
        value={dueAt}
        now={now}
        timeFormat={timeFormat}
        weekStart={weekStart}
        anchor={point}
        placement="point"
        offset={{ y: -40 }}
        returnFocus={opener}
        onChange={(ms) => { onSetDue?.(ms); close(); }}
        onCancel={close}
      />
    );
  }

  return (
    <>
      <Popover
        anchor={point}
        placement="point"
        className="tp-menu"
        role="menu"
        label="할 일 메뉴"
        returnFocus={opener}
        onClose={close}
        onKeyDown={onMenuKey}
      >
        <div ref={menuRef} className="tp-menu-in">
          <Item icon={<OpenIcon />} label="열기" hint="Enter" onClick={act(onOpen)} {...others} />
          <div className="tp-sp" />
          <div className="tp-hd" aria-hidden="true">기한</div>
          <Item icon={<SunIcon />} label="오늘" onClick={setDue("today")} {...others} />
          <Item icon={<WeekIcon />} label="내일" onClick={setDue("tomorrow")} {...others} />
          {hasDue && <Item icon={<DayLaterIcon />} label="하루 미루기" onClick={setDue("plus1")} {...others} />}
          {hasDue && <Item icon={<WeekLaterIcon />} label="일주일 미루기" onClick={setDue("plus7")} {...others} />}
          <Item icon={<CalendarIcon />} label="날짜 · 시간 정하기…" onClick={() => setMode("date")} {...others} />
          {hasDue && <Item icon={<ClearIcon />} label="기한 없애기" onClick={act(() => onSetDue?.(null))} {...others} />}
          <div className="tp-sp" />
          <Item icon={<StarIcon filled={important} size={15} />} label={important ? "중요 해제" : "중요로 표시"} onClick={act(onToggleImportant)} {...others} />
          <button
            ref={subItemRef}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-haspopup="menu"
            aria-expanded={!!sub}
            className={`tp-mi has-sub${sub ? " open" : ""}`}
            onMouseEnter={() => setSub((s) => s || "hover")}
            onClick={() => setSub((s) => s || "keyboard")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSub("keyboard"); } }}
          >
            <span className="tp-mic"><TagIcon /></span>
            <span className="tp-lb">카테고리</span>
            <span className="tp-kb tp-chev"><NextIcon /></span>
          </button>
          <Item icon={<CopyIcon />} label="복제" onClick={act(onDuplicate)} {...others} />
          <div className="tp-sp" />
          <Item icon={<TrashIcon />} label="삭제" hint="Del" danger onClick={act(onDelete)} {...others} />
        </div>
      </Popover>
      {sub && (
        <Popover
          anchor={subItemRef}
          placement="right-start"
          offset={{ y: -6 }}
          className="tp-menu tp-sub"
          role="menu"
          label="카테고리"
          autoFocus={sub === "keyboard"}
          initialFocus={{ get current() { return subRef.current?.querySelector(".tp-mi"); } }}
          onClose={(reason) => { setSub(null); if (reason === "escape") subItemRef.current?.focus(); }}
          onKeyDown={onSubKey}
        >
          <div ref={subRef}>
            {categories.map((c) => {
              const on = assigned.has(c.id);
              const tint = categoryColor(c);
              return (
                <button key={c.id} type="button" role="menuitemcheckbox" aria-checked={on} tabIndex={-1} className={`tp-mi${on ? " on" : ""}`} onClick={() => onToggleCategory?.(c.id)}>
                  <span className="tp-mic">
                    {c.secret ? <span style={{ color: tint, display: "grid" }} role="img" aria-label="비밀 카테고리"><ShieldIcon /></span> : <span className="tp-dot" style={{ background: tint }} />}
                  </span>
                  <span className="tp-lb">{c.title ?? c.name}</span>
                  {on && <span className="tp-ok"><TickIcon /></span>}
                </button>
              );
            })}
            {categories.length > 0 && <div className="tp-sp" />}
            <button type="button" role="menuitem" tabIndex={-1} className="tp-mi" onClick={act(onNewCategory)}>
              <span className="tp-mic"><PlusIcon size={14} /></span>
              <span className="tp-lb">새 카테고리…</span>
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}
