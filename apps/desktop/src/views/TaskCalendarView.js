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
import { dueMs } from "utils/timeDisplay";
import { CategoryMark, JumpTitle, ViewHeader, ViewNav, WEEKDAYS, addDays, dayStart, markCategory, taskCategories, tasksByDay, useElementSize } from "./viewParts";

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
// the task menu. The grid follows the screen's tasks (menu, category, search: filteredTaskMap).
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

  const days = useMemo(() => tasksByDay(filteredTaskMap, { hideDone: !!prefs.hideDone }), [filteredTaskMap, prefs.hideDone]);
  const cells = useMemo(() => monthCells(year, month, weekStart), [year, month, weekStart]);
  const weeks = cells.length / 7;

  const gridRef = useRef(null);
  const { height: gridHeight } = useElementSize(gridRef);
  const lines = gridHeight > 0 ? cellLines((gridHeight - 28 - weeks) / weeks) : Infinity;

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

  // One day of the grid.
  const dayCell = (date) => {
    const ms = date.getTime(), wd = date.getDay();
    const list = daySort(days[ms] ?? []);
    const { shown, more } = cellItems(list, lines);
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
        aria-label={`${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일${list.length ? ` 할 일 ${list.length}개` : ""}`}
        onClick={() => pick(ms)}
      >
        <span className="cv-d">{date.getDate()}</span>
        {shown.map((task) => {
          const mark = markCategory(taskCategories(task, categories, catsOf));
          return (
            <div
              key={task.id}
              className={"cv-ev" + (task.done ? " done" : isOverdue(task, now) ? " over" : "")}
              data-task-id={task.id}
              onContextMenu={(event) => {
                if (!onTaskContextMenu) return;
                event.preventDefault();
                event.stopPropagation();
                // Items cannot take focus: after the menu (and a delete question) focus
                // goes back to the day.
                onTaskContextMenu(event, task.id, event.currentTarget.closest('[role="gridcell"]'));
              }}
            >
              <CategoryMark category={mark} size={11} />
              <b>{task.title}</b>
            </div>
          );
        })}
        {more > 0 && <div className="cv-ev more"><b>{shown.length ? `…외 ${more}개` : `할 일 ${more}개`}</b></div>}
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
            {weekdayOrder(weekStart).map((wd) => (
              <div key={`w${wd}`} className={"cv-wd" + (wd === 0 ? " sun" : wd === 6 ? " sat" : "")} role="columnheader">{WEEKDAYS[wd]}</div>
            ))}
          </div>
          {Array.from({ length: weeks }, (_, w) => (
            <div key={`r${w}`} className="cv-row" role="row">
              {cells.slice(w * 7, w * 7 + 7).map(dayCell)}
            </div>
          ))}
        </div>
      </div>
      {renderQuickAdd?.(picked)}
    </div>
  );
};

export default TaskCalendarView;
