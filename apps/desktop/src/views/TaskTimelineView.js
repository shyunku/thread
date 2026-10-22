import "components/list/TaskRow.scss";
import "./TaskTimelineView.scss";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { usePickedDay } from "components/panel/pickedDay";
import { useTaskSelection } from "components/list/taskSelection";
import useTaskCompletion, { restoreRow } from "components/list/useTaskCompletion";
import useClock from "hooks/UseClock";
import { moveFocus } from "molecules/pickers/focusNav";
import { CheckIcon, StarIcon } from "molecules/pickers/icons";
import MiniMonth from "molecules/pickers/MiniMonth";
import Popover from "molecules/pickers/Popover";
import Toast from "molecules/Toast";
import { prefsSelector } from "store/prefsSlice";
import { isOverdue } from "utils/menuFilters";
import { dueMs, formatClock, formatClockShort, hasDueTime } from "utils/timeDisplay";
import { CategoryMark, JumpTitle, ViewHeader, ViewNav, WEEKDAYS, addDays, dayStart, markCategory, taskCategories, tasksByDay, useElementSize } from "./viewParts";

// Day columns that fit the pane (#102 mock timelinePane): at least 240px each, 12px apart,
// inside the 32px gutters; 1 to 5.
export const MAX_COLUMNS = 5;
export function timelineColumns(paneWidth) {
  return Math.max(1, Math.min(MAX_COLUMNS, Math.floor((paneWidth - 64 + 12) / 252)));
}

// A due without a chosen time (23:59) goes under 하루 끝, after the hours.
export const END_OF_DAY_HOUR = 24;
const hourOf = (due) => (hasDueTime(due) ? new Date(due).getHours() : END_OF_DAY_HOUR);

// A column's tasks by due, in hour groups: [{ hour, tasks }]; only hours that have tasks.
export function hourGroups(tasks) {
  const groups = [];
  for (const task of [...tasks].sort((a, b) => dueMs(a.dueDate) - dueMs(b.dueDate))) {
    const hour = hourOf(dueMs(task.dueDate));
    const last = groups[groups.length - 1];
    if (last && last.hour === hour) last.tasks.push(task);
    else groups.push({ hour, tasks: [task] });
  }
  return groups;
}

const hourLabel = (hour, timeFormat) => (hour === END_OF_DAY_HOUR ? "하루 끝" : formatClockShort(new Date(2000, 0, 1, hour), timeFormat));

// "10월 21일 – 25일", "10월 30일 – 11월 3일"; the year when it is not this year.
function rangeTitle(first, last, today) {
  const a = new Date(first), b = new Date(last), year = new Date(today).getFullYear();
  const head = `${a.getFullYear() !== year ? `${a.getFullYear()}년 ` : ""}${a.getMonth() + 1}월 ${a.getDate()}일`;
  if (first === last) return head;
  const tail = (b.getFullYear() !== a.getFullYear() ? `${b.getFullYear()}년 ` : "") +
    (b.getFullYear() !== a.getFullYear() || b.getMonth() !== a.getMonth() ? `${b.getMonth() + 1}월 ` : "") + `${b.getDate()}일`;
  return `${head} – ${tail}`;
}

// The title's jump popup (mock jumpPop, timeline): the month calendar of the pickers with the
// first column's day picked; ‹ › change the month. A day (or 오늘로) becomes the first column
// and closes the popup. Arrow keys only move the pick inside the popup; Enter takes it.
export function DayJump({ anchor, first, today, weekStart, onPick, onClose }) {
  const [cursor, setCursor] = useState(first);
  const [shown, setShown] = useState(() => ({ year: new Date(first).getFullYear(), month: new Date(first).getMonth() }));
  const rootRef = useRef(null);
  const byKey = useRef(false);
  const [initial] = useState(() => ({ get current() { return rootRef.current?.querySelector('.tp-mm-c[tabindex="0"]'); } }));
  return (
    <Popover anchor={anchor} placement="bottom-start" gap={12} className="tc-jump-pop tl" label="날짜로 가기" initialFocus={initial} returnFocus={anchor} onClose={onClose}>
      <div ref={rootRef} onKeyDownCapture={(event) => { byKey.current = event.key.startsWith("Arrow"); }}>
        <MiniMonth
          year={shown.year}
          month={shown.month}
          picked={cursor}
          today={today}
          weekStart={weekStart}
          arrowTips
          onPick={(date) => {
            const day = dayStart(date);
            if (!byKey.current) { onPick(day); return; }
            byKey.current = false;
            setCursor(day);
            setShown({ year: date.getFullYear(), month: date.getMonth() });
          }}
          onMonth={(delta) => setShown(({ year, month }) => {
            const d = new Date(year, month + delta, 1);
            return { year: d.getFullYear(), month: d.getMonth() };
          })}
        />
      </div>
      <div className="jp-foot">
        <button type="button" className="jp-btn" onClick={() => onPick(today)}>오늘로</button>
      </div>
    </Popover>
  );
}

// A row like the list's (check, title, meta, read-only star; mock .tl-task). Click opens the
// detail, right-click the task menu, Space completes.
function TimelineRow({ task, cats, selected, timeFormat, now, onOpen, onMenu, onToggleDone, onKeyDown }) {
  const ref = useRef(null);
  const [pop, setPop] = useState(false);
  const done = !!task.done;
  const due = dueMs(task.dueDate);
  const first = markCategory(cats);
  const timeText = due !== null && hasDueTime(due) && new Date(due).getMinutes() ? formatClock(new Date(due), timeFormat) : "";
  const overdue = isOverdue(task, now);

  useEffect(() => {
    if (!pop) return undefined;
    const timer = setTimeout(() => setPop(false), 1200);
    return () => clearTimeout(timer);
  }, [pop]);
  // Done tasks stay in the timeline (struck through): show the row again after the fall.
  useEffect(() => {
    if (done && ref.current) restoreRow(ref.current);
  }, [done]);

  const complete = () => {
    if (done) return onToggleDone?.(task, ref.current, false);
    if (pop) return undefined;
    setPop(true);
    onToggleDone?.(task, ref.current, true);
    return undefined;
  };

  return (
    <div
      ref={ref}
      className={"task-row tv-task" + (done ? " done" : "") + (selected ? " sel" : "") + (first || timeText ? "" : " no-meta")}
      data-task-id={task.id}
      tabIndex={0}
      role="option"
      aria-selected={selected}
      aria-label={task.title}
      onClick={() => onOpen?.(task.id)}
      onContextMenu={(event) => {
        if (!onMenu) return;
        event.preventDefault();
        onMenu(event, task.id);
      }}
      onKeyDown={(event) => {
        if (event.target === ref.current && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          if (event.repeat) return;
          if (event.key === "Enter") onOpen?.(task.id);
          else complete();
          return;
        }
        onKeyDown?.(event, ref.current);
      }}
    >
      <button
        type="button"
        className={"ck" + (done || pop ? " done" : "") + (pop && !done ? " pop" : "")}
        role="checkbox"
        aria-checked={done || pop}
        aria-label={done ? "완료 취소" : "할 일 완료"}
        tabIndex={-1}
        onClick={(event) => { event.stopPropagation(); complete(); }}
      >
        <CheckIcon />
      </button>
      <div className="tx">
        <div className="t">{task.title}</div>
        {(first || timeText) && (
          <div className="meta">
            {first && (
              <span className="cat">
                <CategoryMark category={first} />
                <b>{first.title}</b>
              </span>
            )}
            {timeText && <span className={overdue ? "over" : ""}>{timeText}</span>}
          </div>
        )}
      </div>
      {task.important && <span className="st on" role="img" aria-label="중요"><StarIcon filled size={17} /></span>}
    </div>
  );
}

// The timeline (#102 mock timelinePane): day columns from the picked day, as many as fit the
// pane. Each has a header (date, weekday, 오늘, open count) and the hours that have tasks; today's
// column has the 지금 line. ‹ › move a day (a week with Shift), the title jumps to a day, 오늘 goes
// back to today (the picked day moves with
// them, so the quick add and the panel follow). Columns scroll on their own, so the wheel does
// not change days.
// Props from TodoContent: filteredTaskMap, categories, catsOf?, header?, renderQuickAdd(day)?,
// onTaskContextMenu(event, taskId)?, onOpenTask(taskId)?, onToggleDone(task, row, done)?,
// searchNote? (in search: "검색 결과 N개", put before the summary).
const TaskTimelineView = ({ filteredTaskMap, categories, catsOf, header, renderQuickAdd, onTaskContextMenu, onOpenTask, onToggleDone, searchNote }) => {
  const prefs = useSelector(prefsSelector);
  const timeFormat = prefs.timeFormat === "24" ? "24" : "12";
  const { pickedDay, setPickedDay } = usePickedDay();
  const { selectedTaskId, openTask, actions } = useTaskSelection();
  const today = useClock((t) => dayStart(t));
  const now = useClock((t) => Math.floor(t / 60000) * 60000);
  const first = pickedDay ?? today;

  const paneRef = useRef(null);
  const { width } = useElementSize(paneRef);
  const count = timelineColumns(width);
  const columns = useMemo(() => Array.from({ length: count }, (_, i) => addDays(first, i)), [first, count]);

  const days = useMemo(() => tasksByDay(filteredTaskMap, { hideDone: !!prefs.hideDone }), [filteredTaskMap, prefs.hideDone]);

  // Completion like the list's (pop, fall); TodoContent's when given.
  const ownComplete = useTaskCompletion((task, done, onFailed) =>
    actions?.setDone?.(task.id, done, ({ success } = {}) => {
      if (success !== false) return;
      Toast.error(done ? "완료하지 못했어요." : "완료를 취소하지 못했어요.");
      onFailed?.();
    }));
  const complete = onToggleDone ?? ownComplete;
  const open = onOpenTask ?? openTask;

  let openCount = 0, overCount = 0;
  const last = columns[columns.length - 1];
  for (const task of Object.values(filteredTaskMap ?? {})) {
    const due = dueMs(task?.dueDate);
    if (due === null || task.done) continue;
    if (due >= first && due < addDays(last, 1)) openCount++;
    if (isOverdue(task, now)) overCount++;
  }
  const summary = (
    <>
      {searchNote && `${searchNote} · `}{count}일 · {openCount ? `남은 할 일 ${openCount}개` : "남은 할 일이 없어요"}
      {overCount > 0 && <> · <b>기한 지난 할 일 {overCount}개</b>는 목록에서 볼 수 있어요</>}
    </>
  );

  // Today's column starts at the 지금 line.
  const colsRef = useRef(null);
  useEffect(() => {
    const line = colsRef.current?.querySelector(".tv-col.today .tv-now");
    const body = line?.closest(".tv-body");
    if (body) body.scrollTop = Math.max(0, line.offsetTop - body.offsetTop - 48);
  }, [first, count]);

  const onRowKey = (event, row) => {
    if (event.target === row) moveFocus(event, row.closest(".tv-body"), ".tv-task");
  };

  return (
    <div className="task-timeline-view" ref={paneRef}>
      <ViewHeader
        header={header}
        title={rangeTitle(first, last, today)}
        summary={summary}
        heading={(
          <JumpTitle
            title={rangeTitle(first, last, today)}
            tip="날짜로 가기"
            renderPopup={({ anchor, close }) => (
              <DayJump
                anchor={anchor}
                first={first}
                today={today}
                weekStart={prefs.weekStart === 1 ? 1 : 0}
                onPick={(day) => { setPickedDay(day); close(); }}
                onClose={close}
              />
            )}
          />
        )}
        nav={(
          <ViewNav
            prevLabel="하루 전"
            nextLabel="하루 뒤"
            prevTip="하루 전 · Shift 한 주 전"
            nextTip="하루 뒤 · Shift 한 주 뒤"
            onPrev={(event) => setPickedDay(addDays(first, event?.shiftKey ? -7 : -1))}
            onNext={(event) => setPickedDay(addDays(first, event?.shiftKey ? 7 : 1))}
            onToday={() => setPickedDay(today)}
          />
        )}
      />
      <div className="tv-cols" ref={colsRef}>
        {columns.map((day) => {
          const date = new Date(day);
          const tasks = days[day] ?? [];
          const groups = hourGroups(tasks);
          const isToday = day === today;
          const nowHour = new Date(now).getHours();
          const nowLine = <div key="now" className="tv-now"><span>지금 {formatClockShort(new Date(now), timeFormat)}</span></div>;
          const body = [];
          let nowDrawn = !isToday;
          for (const group of groups) {
            if (!nowDrawn && group.hour > nowHour) { body.push(nowLine); nowDrawn = true; }
            const label = hourLabel(group.hour, timeFormat);
            body.push(
              <div key={`h${group.hour}`} className="tv-group">
                <div className="tv-hour">{label}</div>
                <div className="tv-box" role="listbox" aria-label={label}>
                  {group.tasks.map((task) => (
                    <TimelineRow
                      key={task.id}
                      task={task}
                      cats={taskCategories(task, categories, catsOf)}
                      selected={task.id === selectedTaskId}
                      timeFormat={timeFormat}
                      now={now}
                      onOpen={open}
                      onMenu={onTaskContextMenu}
                      onToggleDone={complete}
                      onKeyDown={onRowKey}
                    />
                  ))}
                </div>
              </div>
            );
          }
          if (!nowDrawn) body.push(nowLine);
          if (!tasks.length) body.push(<div key="empty" className="tv-empty">할 일 없음</div>);
          return (
            <section key={day} className={"tv-col" + (isToday ? " today" : "")} aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`}>
              <div className="tv-head">
                <b>{date.getDate()}</b>
                <span>{WEEKDAYS[date.getDay()]}요일</span>
                {isToday && <em>오늘</em>}
                <span className="cnt" aria-label={`남은 할 일 ${tasks.filter((t) => !t.done).length}개`}>{tasks.filter((t) => !t.done).length}</span>
              </div>
              <div className="tv-body">{body}</div>
            </section>
          );
        })}
      </div>
      {renderQuickAdd?.(first)}
    </div>
  );
};

export default TaskTimelineView;
