import { useEffect, useMemo, useState } from "react";
import useClock from "hooks/UseClock";
import MiniMonth from "molecules/pickers/MiniMonth";
import { ShieldIcon } from "molecules/pickers/icons";
import { categoryColor } from "utils/categoryColors";
import { isOverdue } from "utils/menuFilters";
import { dueMs, formatClockShort, hasDueTime } from "utils/timeDisplay";
import { markCategory } from "views/viewParts";
import { startOfDay, usePickedDay } from "./pickedDay";

const WEEKDAYS = "일월화수목금토";

// Order of a day's list (#101 selected-day order, as the calendar view's sortByDue): earliest due
// first; ties keep the screen's order.
export function sortByDue(tasks) {
  return [...tasks].sort((a, b) => (dueMs(a.dueDate) ?? Infinity) - (dueMs(b.dueDate) ?? Infinity));
}

// The tasks due on `day` among the shown ones (done ones too, unless 완료한 할 일 숨기기): open
// ones first, each part by due (as the calendar cells).
export function dayTasks(tasks, day, { hideDone = false } = {}) {
  const start = startOfDay(day);
  const list = Object.values(tasks ?? {}).filter((task) => {
    const due = dueMs(task.dueDate);
    return due !== null && startOfDay(due) === start && !(hideDone && task.done);
  });
  return sortByDue(list).sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
}

// Day marks of the mini calendar: a dot under days with open tasks, red when one is overdue.
export function dayMarks(tasks, now) {
  const marks = new Map();
  for (const task of Object.values(tasks ?? {})) {
    const due = dueMs(task.dueDate);
    if (due === null || task.done) continue;
    const key = startOfDay(due);
    if (isOverdue(task, now)) marks.set(key, "over");
    else if (!marks.has(key)) marks.set(key, "open");
  }
  return marks;
}

// The picked day's list (#102 mock dayList): the header with the open count, then each task with
// its clock time (하루 끝 without a chosen time) and category (the shield when any of its
// categories is secret). Clicking opens its detail; right-click opens the task menu.
export function DayList({ tasks, catsOf, prefs, onOpen, onMenu }) {
  const { pickedDay } = usePickedDay();
  const tf = prefs?.timeFormat === "24" ? "24" : "12";
  const list = useMemo(() => dayTasks(tasks, pickedDay, { hideDone: !!prefs?.hideDone }), [tasks, pickedDay, prefs?.hideDone]);
  const today = useClock((now) => startOfDay(now));
  const minute = useClock((now) => Math.floor(now / 60000));
  const d = new Date(pickedDay);
  const left = list.filter((t) => !t.done).length;
  return (
    <>
      <div className="rp-block-h">
        {d.getMonth() + 1}월 {d.getDate()}일 ({WEEKDAYS[d.getDay()]}){pickedDay === today ? " · 오늘" : ""}
        <span>{left}개 남음</span>
      </div>
      <div className="rp-box rp-agenda" role="list" aria-label="이날 할 일">
        {list.length ? list.map((task) => {
          const first = markCategory(catsOf?.(task) ?? []);
          const due = dueMs(task.dueDate);
          const over = isOverdue(task, minute * 60000);
          return (
            <div
              key={task.id}
              role="listitem"
              tabIndex={0}
              className={"rp-ai" + (task.done ? " done" : "")}
              data-task-id={task.id}
              aria-label={task.title}
              onClick={() => onOpen?.(task.id)}
              onContextMenu={(event) => onMenu?.(event, task.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || event.key !== "Enter") return;
                event.preventDefault();
                onOpen?.(task.id);
              }}
            >
              <span className={"rp-tm" + (over ? " over" : "")}>{hasDueTime(due) ? formatClockShort(new Date(due), tf) : "하루 끝"}</span>
              {first?.secret ? (
                <span className="rp-shield" style={{ color: categoryColor(first) }} role="img" aria-label="비밀 카테고리"><ShieldIcon size={11} /></span>
              ) : (
                <span className="rp-dot" style={{ background: first ? categoryColor(first) : "var(--faint)" }} />
              )}
              <span className="rp-nm">{task.title}</span>
            </div>
          );
        }) : <div className="rp-none">이날은 할 일이 없어요</div>}
      </div>
    </>
  );
}

// 캘린더 tab (#102 mock calendarBody): the mini month (today ring, picked day filled, dots for
// days with open tasks) above the picked day's list. The picked day is shared with the calendar
// view (usePickedDay).
export default function CalendarTab(props) {
  const { tasks, prefs } = props;
  const { pickedDay, setPickedDay } = usePickedDay();
  const [month, setMonth] = useState(() => ({ year: new Date(pickedDay).getFullYear(), month: new Date(pickedDay).getMonth() }));
  // A day picked elsewhere (the calendar view, 오늘) brings its month.
  useEffect(() => {
    const d = new Date(pickedDay);
    setMonth({ year: d.getFullYear(), month: d.getMonth() });
  }, [pickedDay]);
  const today = useClock((now) => startOfDay(now));
  const minute = useClock((now) => Math.floor(now / 60000));
  const marks = useMemo(() => dayMarks(tasks, minute * 60000), [tasks, minute]);
  const moveMonth = (delta) => setMonth((m) => {
    const d = new Date(m.year, m.month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  return (
    <>
      <div className="rp-box rp-mini">
        <MiniMonth
          year={month.year}
          month={month.month}
          picked={pickedDay}
          today={today}
          weekStart={prefs?.weekStart === 1 ? 1 : 0}
          onPick={(date) => setPickedDay(date)}
          onMonth={moveMonth}
          marks={(date) => marks.get(startOfDay(date)) ?? null}
        />
      </div>
      <DayList {...props} />
    </>
  );
}
