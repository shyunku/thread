import "./TaskCalendarView.scss";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { usePickedDay } from "components/panel/pickedDay";
import useClock from "hooks/UseClock";
import { useHomeLayout } from "layouts/homeLayoutContext";
import { NextIcon, PrevIcon } from "molecules/pickers/icons";
import { monthCells } from "molecules/pickers/MiniMonth";
import Popover from "molecules/pickers/Popover";
import { prefsSelector } from "store/prefsSlice";
import { weekdayOrder } from "utils/dateGroups";
import { isOverdue } from "utils/menuFilters";
import { periodText } from "utils/periodDisplay";
import { isMultiDayPeriod } from "utils/taskPeriod";
import { dueMs, formatClockShort, hasDueTime } from "utils/timeDisplay";
import { CategoryMark, JumpTitle, ViewHeader, ViewNav, WEEKDAYS, addDays, barStyle, dayStart, markCategory, periodLanes, taskCategories, useElementSize } from "./viewParts";

// A day's items: open first, then by due (mock calendarPane).
export function daySort(tasks) {
  return [...tasks].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || dueMs(a.dueDate) - dueMs(b.dueDate));
}

// Item lines a day cell has room for, from its height (padding 6+6, the day number 22+4, a line
// 22+2). Unknown height (not laid out) → room for all.
const DAY_HEAD = 38;
const LINE = 24;
export const MAX_ITEMS = 3;
export function cellLines(cellHeight) {
  if (!(cellHeight > 0)) return Infinity;
  return Math.max(0, Math.floor((cellHeight - DAY_HEAD) / LINE));
}

// Which items a cell shows: up to 3 (fewer when the cell is short), then "…외 N개" (only
// "할 일 N개" when a single line is left).
export function cellItems(tasks, lines = Infinity) {
  const fit = Math.min(MAX_ITEMS + 1, lines);
  if (tasks.length <= Math.min(MAX_ITEMS, fit)) return { shown: tasks, more: 0 };
  const shown = tasks.slice(0, Math.max(0, Math.min(MAX_ITEMS, fit - 1)));
  return { shown, more: tasks.length - shown.length };
}

// One week row (#109 mock calView): periods over several days are bars in lanes across the
// days they cover, the other tasks one-line items on their due day. A cell shows its lanes,
// then its items, up to the cellItems rule (3, fewer when short; bars count as lines); what
// does not fit is "…외 N개". A bar is drawn in runs over the days its lane shows.
// tasks: those with a due; first: the row's first day (ms); lines: cellLines of the cells.
// Returns { days: [{ day, lanes, items, more, count }], bars: [{ task, from, to, lane, contL,
// contR, endTime }] }: lanes the lanes kept open, count every task on the day; from/to the
// columns of a run, contL/contR whether the period goes on past its left or right end, endTime
// whether it ends there at a set time ("~오후 6시").
export function weekLayout(tasks, first, lines = Infinity) {
  const { segs } = periodLanes(tasks, first, 7);
  const fit = Math.min(MAX_ITEMS + 1, lines);
  const days = [];
  for (let d = 0; d < 7; d++) {
    const day = addDays(first, d);
    const items = daySort(tasks.filter((t) => !isMultiDayPeriod(t) && dayStart(dueMs(t.dueDate)) === day));
    const covering = segs.filter((g) => g.a <= d && d <= g.b);
    const used = covering.length ? Math.max(...covering.map((g) => g.lane)) + 1 : 0;
    let lanes = used, shown = items, more = 0;
    if (used + items.length > Math.min(MAX_ITEMS, fit)) {
      const room = Math.max(0, Math.min(MAX_ITEMS, fit - 1));
      lanes = Math.min(used, room);
      shown = items.slice(0, Math.max(0, room - lanes));
      more = covering.filter((g) => g.lane >= lanes).length + items.length - shown.length;
    }
    days.push({ day, lanes, items: shown, more, count: covering.length + items.length });
  }
  const bars = [];
  const last = addDays(first, 6);
  for (const g of segs) {
    for (let d = g.a; d <= g.b;) {
      if (g.lane >= days[d].lanes) { d++; continue; }
      let e = d;
      while (e + 1 <= g.b && g.lane < days[e + 1].lanes) e++;
      const contL = d > g.a || dayStart(g.start) < first, contR = e < g.b || dayStart(g.end) > last;
      bars.push({ task: g.task, from: d, to: e, lane: g.lane, contL, contR, endTime: !contR && e > d && hasDueTime(g.end) });
      d = e + 1;
    }
  }
  return { days, bars };
}

const monthOf = (ms) => { const d = new Date(ms); return { year: d.getFullYear(), month: d.getMonth() }; };

// The title's jump popup (mock jumpPop, calendar): the months of a year, ‹ › change the year.
// The shown month is filled, the current month ringed. A month (or 이번 달) shows that month and
// closes the popup. Arrow keys move between the months (a row has 4).
export function MonthJump({ anchor, shown, current, onPick, onClose }) {
  const [year, setYear] = useState(shown.year);
  const gridRef = useRef(null);
  const focusMonth = year === shown.year ? shown.month : year === current.year ? current.month : 0;
  const [initial] = useState(() => ({ get current() { return gridRef.current?.querySelector(`[data-month="${focusMonth}"]`); } }));
  const onKeyDown = (event) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
    const from = Number(event.target.dataset?.month);
    if (steps[event.key] === undefined || Number.isNaN(from)) return;
    event.preventDefault();
    const to = Math.min(11, Math.max(0, from + steps[event.key]));
    gridRef.current?.querySelector(`[data-month="${to}"]`)?.focus();
  };
  return (
    <Popover anchor={anchor} placement="bottom-start" gap={12} className="tc-jump-pop" label="달로 가기" initialFocus={initial} returnFocus={anchor} onClose={onClose}>
      <div className="jp-h">
        <span aria-live="polite">{year}년</span>
        <span className="jp-nav">
          <button type="button" className="jp-arrow" aria-label="이전 해" data-tip="이전 해" onClick={() => setYear((y) => y - 1)}><PrevIcon /></button>
          <button type="button" className="jp-arrow" aria-label="다음 해" data-tip="다음 해" onClick={() => setYear((y) => y + 1)}><NextIcon /></button>
        </span>
      </div>
      <div className="jp-grid" role="group" aria-label={`${year}년`} ref={gridRef} onKeyDown={onKeyDown}>
        {Array.from({ length: 12 }, (_, m) => {
          const isShown = year === shown.year && m === shown.month, isCurrent = year === current.year && m === current.month;
          return (
            <button
              key={m}
              type="button"
              className={"jp-m" + (isShown ? " cur" : "") + (isCurrent ? " today" : "")}
              data-month={m}
              aria-pressed={isShown}
              aria-current={isCurrent ? "date" : undefined}
              tabIndex={m === focusMonth ? 0 : -1}
              onClick={() => onPick({ year, month: m })}
            >
              {m + 1}월
            </button>
          );
        })}
      </div>
      <div className="jp-foot">
        <button type="button" className="jp-btn" onClick={() => onPick(current)}>이번 달</button>
      </div>
    </Popover>
  );
}

// The main calendar (#102 mock calendarPane): a month grid from 주 시작 요일, as many weeks as the
// month needs; a day shows up to 3 one-line items (category dot, the shield for a secret task;
// red when overdue, struck through when done) and "…외 N개". A press picks the day, which the
// right panel lists ("선택한 날") and the quick add starts from. Right-click on an item opens
// the task menu. A period over several days is a bar across its days (#109, weekLayout). The
// grid follows the screen's tasks (menu, category, search: filteredTaskMap).
// Props from TodoContent: filteredTaskMap, categories, catsOf?, header?, renderQuickAdd(day)?,
// onTaskContextMenu(event, taskId, returnEl)?, searchNote? (in search: "검색 결과 N개", put
// before the summary).
const TaskCalendarView = ({ filteredTaskMap, categories, catsOf, header, renderQuickAdd, onTaskContextMenu, searchNote }) => {
  const prefs = useSelector(prefsSelector);
  const weekStart = prefs.weekStart === 1 ? 1 : 0;
  const { pickedDay, setPickedDay } = usePickedDay();
  const layout = useHomeLayout();
  const today = useClock((now) => dayStart(now));
  const picked = pickedDay ?? today;

  const [shownMonth, setShownMonth] = useState(() => monthOf(picked));
  // The month follows the picked day (a press on another month's day, the panel, 오늘).
  useEffect(() => { setShownMonth(monthOf(picked)); }, [picked]);
  const { year, month } = shownMonth;
  const moveMonth = (delta) => setShownMonth(({ year: y, month: m }) => monthOf(new Date(y, m + delta, 1)));
  // ‹ › move a month, a year with Shift.
  const step = (event, dir) => moveMonth(dir * (event?.shiftKey ? 12 : 1));

  const dated = useMemo(
    () => Object.values(filteredTaskMap ?? {}).filter((t) => dueMs(t?.dueDate) !== null && !(prefs.hideDone && t.done)),
    [filteredTaskMap, prefs.hideDone]
  );
  const cells = useMemo(() => monthCells(year, month, weekStart), [year, month, weekStart]);
  const weeks = cells.length / 7;

  const gridRef = useRef(null);
  const { height: gridHeight } = useElementSize(gridRef);
  const lines = gridHeight > 0 ? cellLines((gridHeight - 28 - weeks) / weeks) : Infinity;
  const layout0 = useMemo(
    () => Array.from({ length: weeks }, (_, w) => weekLayout(dated, cells[w * 7].getTime(), lines)),
    [dated, cells, weeks, lines]
  );

  const monthStart = new Date(year, month, 1).getTime(), monthEnd = new Date(year, month + 1, 1).getTime();
  let openInMonth = 0;
  for (const task of Object.values(filteredTaskMap ?? {})) {
    const due = dueMs(task?.dueDate);
    if (!task.done && due !== null && due >= monthStart && due < monthEnd) openInMonth++;
  }
  const current = monthOf(today);
  const monthName = current.year === year && current.month === month ? "이번 달" : `${month + 1}월`;
  const summary = `${searchNote ? `${searchNote} · ` : ""}${monthName} 남은 할 일 ${openInMonth}개`;

  const pick = (ms) => {
    setPickedDay(dayStart(ms));
    // Narrow windows: the panel is a drawer; picking a day opens it on that day's list.
    if (layout.overlayPanel) layout.setPanelOpen?.(true);
  };

  // Arrow keys move the pick by a day or a week; focus follows it, also into another month once
  // its grid is drawn.
  const keyboard = useRef(false);
  useEffect(() => {
    if (!keyboard.current) return;
    const el = gridRef.current?.querySelector(`[data-day="${picked}"]`);
    if (!el) return;
    keyboard.current = false;
    el.focus({ preventScroll: true });
  });
  const onKeyDown = (event) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.target.getAttribute?.("role") !== "gridcell") return;
    if (steps[event.key] !== undefined) {
      event.preventDefault();
      keyboard.current = true;
      setPickedDay(addDays(picked, steps[event.key]));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(Number(event.target.dataset.day));
    }
  };

  const now = useClock((t) => Math.floor(t / 60000) * 60000); // overdue by the minute
  const pickedInGrid = cells.some((d) => d.getTime() === picked);
  const focusDay = pickedInGrid ? picked : new Date(year, month, 1).getTime();

  const menuOn = (taskId, returnEl) => (event) => {
    if (!onTaskContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    // Items cannot take focus: after the menu (and a delete question) focus goes back to the day.
    onTaskContextMenu(event, taskId, returnEl(event));
  };
  const dayOf = (event) => event.currentTarget.closest('[role="gridcell"]');

  // One day of the grid (w: its week row, d: its column).
  const dayCell = (date, w, d) => {
    const ms = date.getTime(), wd = date.getDay();
    const { lanes, items: shown, more, count } = layout0[w].days[d];
    const isToday = ms === today, isPicked = ms === picked;
    const cls = ["cv-day", date.getMonth() !== month && "out", isToday && "today", isPicked && "picked", wd === 0 ? "sun" : wd === 6 ? "sat" : ""]
      .filter(Boolean).join(" ");
    return (
      <div
        key={ms}
        className={cls}
        role="gridcell"
        data-day={ms}
        tabIndex={ms === focusDay ? 0 : -1}
        aria-selected={isPicked}
        aria-current={isToday ? "date" : undefined}
        aria-label={`${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일${count ? ` 할 일 ${count}개` : ""}`}
        style={{ gridRow: w + 2, gridColumn: d + 1 }}
        onClick={() => pick(ms)}
      >
        <span className="cv-d">{date.getDate()}</span>
        {lanes > 0 && <div className="cv-sp" style={{ height: lanes * LINE }} />}
        {shown.map((task) => {
          const mark = markCategory(taskCategories(task, categories, catsOf));
          return (
            <div
              key={task.id}
              className={"cv-ev" + (task.done ? " done" : isOverdue(task, now) ? " over" : "")}
              data-task-id={task.id}
              onContextMenu={menuOn(task.id, dayOf)}
            >
              <CategoryMark category={mark} size={11} />
              <b>{task.title}</b>
            </div>
          );
        })}
        {more > 0 && <div className="cv-ev more"><b>{shown.length || lanes ? `…외 ${more}개` : `할 일 ${more}개`}</b></div>}
      </div>
    );
  };
  // A period's bar over the run from..to of week row w (#109 mock .cv-bar): the category dot at
  // its start, "~오후 6시" where it ends at a set time. A press picks the day under the pointer.
  const periodBar = (bar, w) => {
    const { task, from, to, lane, contL, contR, endTime } = bar;
    const mark = markCategory(taskCategories(task, categories, catsOf));
    const first = cells[w * 7].getTime();
    return (
      <div
        key={`${task.id}-${from}`}
        className={"cv-bar" + (contL ? " cl" : "") + (contR ? " cr" : "") + (task.done ? " done" : "")}
        data-task-id={task.id}
        data-tip={`${task.title} · ${periodText(task, prefs.timeFormat === "24" ? "24" : "12")}`}
        aria-hidden="true"
        style={{ gridRow: w + 2, gridColumn: `${from + 1} / ${to + 2}`, marginTop: DAY_HEAD - 4 + lane * LINE, ...barStyle(mark, task.done, [16, 18, 22]) }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const col = Math.min(to, from + Math.floor((event.clientX - rect.left) / (rect.width / (to - from + 1) || 1)));
          pick(addDays(first, Math.max(from, col)));
        }}
        onContextMenu={menuOn(task.id, () => gridRef.current?.querySelector(`[data-day="${addDays(first, from)}"]`))}
      >
        {!contL && <CategoryMark category={mark} size={11} />}
        <b>{task.title}</b>
        {endTime && <span className="rng">~{formatClockShort(new Date(dueMs(task.dueDate)), prefs.timeFormat === "24" ? "24" : "12")}</span>}
      </div>
    );
  };

  return (
    <div className="task-view calendar">
      <ViewHeader
        header={header}
        title={`${year}년 ${month + 1}월`}
        summary={summary}
        heading={(
          <JumpTitle
            title={`${year}년 ${month + 1}월`}
            tip="달로 가기"
            renderPopup={({ anchor, close }) => (
              <MonthJump
                anchor={anchor}
                shown={shownMonth}
                current={current}
                onPick={(m) => { setShownMonth({ year: m.year, month: m.month }); close(); }}
                onClose={close}
              />
            )}
          />
        )}
        nav={(
          <ViewNav
            prevLabel="이전 달"
            nextLabel="다음 달"
            prevTip="이전 달 · Shift 이전 해"
            nextTip="다음 달 · Shift 다음 해"
            onPrev={(event) => step(event, -1)}
            onNext={(event) => step(event, 1)}
            onToday={() => { setShownMonth(monthOf(today)); setPickedDay(today); }}
          />
        )}
      />
      <div className="cv-body">
        <div
          className="cv-grid"
          ref={gridRef}
          role="grid"
          aria-label={`${year}년 ${month + 1}월`}
          style={{ gridTemplateRows: `28px repeat(${weeks}, minmax(0, 1fr))` }}
          onKeyDown={onKeyDown}
        >
          <div className="cv-row" role="row">
            {weekdayOrder(weekStart).map((wd, i) => (
              <div key={`w${wd}`} className={"cv-wd" + (wd === 0 ? " sun" : wd === 6 ? " sat" : "")} role="columnheader" style={{ gridRow: 1, gridColumn: i + 1 }}>{WEEKDAYS[wd]}</div>
            ))}
          </div>
          {Array.from({ length: weeks }, (_, w) => (
            <div key={`r${w}`} className="cv-row" role="row">
              {cells.slice(w * 7, w * 7 + 7).map((date, d) => dayCell(date, w, d))}
              {layout0[w].bars.map((bar) => periodBar(bar, w))}
            </div>
          ))}
        </div>
      </div>
      {renderQuickAdd?.(picked)}
    </div>
  );
};

export default TaskCalendarView;
