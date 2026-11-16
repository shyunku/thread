import { useEffect, useMemo, useState } from "react";
import useClock from "hooks/UseClock";
import MiniMonth from "molecules/pickers/MiniMonth";
import { ShieldIcon } from "molecules/pickers/icons";
import { categoryColor } from "utils/categoryColors";
import { isOverdue } from "utils/menuFilters";
import { longDate, shortDate } from "utils/dateFormat";
import { clockRange } from "utils/periodDisplay";
import { hasStartTime, periodCoversDay, taskStart } from "utils/taskPeriod";
import { dueMs, formatClockShort, hasDueTime } from "utils/timeDisplay";
import { markCategory } from "views/viewParts";
import { startOfDay, usePickedDay } from "./pickedDay";

const WEEKDAYS = "일월화수목금토";

// Order of a day's list (#101 selected-day order, as the calendar view's sortByDue): earliest due
// first; ties keep the screen's order.
export function sortByDue(tasks) {
  return [...tasks].sort((a, b) => (dueMs(a.dueDate) ?? Infinity) - (dueMs(b.dueDate) ?? Infinity));
}

// The tasks due on `day` among the shown ones, and the periods covering it (#109; done ones too,
// unless 완료한 할 일 숨기기): open ones first, each part by the time they have on the day (the
// due, or a period's start when it ends later).
export function dayTasks(tasks, day, { hideDone = false } = {}) {
  const start = startOfDay(day);
  const list = Object.values(tasks ?? {}).filter((task) => dueMs(task.dueDate) !== null && periodCoversDay(task, start) && !(hideDone && task.done));
  const key = (task) => { const due = dueMs(task.dueDate); return startOfDay(due) === start ? due : taskStart(task) ?? due; };
  return [...list].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || key(a) - key(b));
}

// Day marks of the mini calendar: a dot under days with open tasks (every day of a period), red
// when one is overdue.
export function dayMarks(tasks, now) {
  const marks = new Map();
  for (const task of Object.values(tasks ?? {})) {
    const due = dueMs(task.dueDate);
    if (due === null || task.done) continue;
    const over = isOverdue(task, now);
    for (let key = startOfDay(taskStart(task) ?? due), last = startOfDay(due); key <= last; key = startOfDay(new Date(key).setDate(new Date(key).getDate() + 1))) {
      if (over) marks.set(key, "over");
      else if (!marks.has(key)) marks.set(key, "open");
    }
  }
  return marks;
}

// A task's time on `day` in the picked day's list (#111): a due its clock (하루 끝 without one); a
// period inside the day its clocks ("오후 7시 ~ 9시"); a period's last day, or one inside the day
// that starts without a time, "~오후 6시" ("~하루 끝"); a
// day before the end "~11.20" (numeric dates). tone: "run" while the period is on now, "over" when
// overdue, else "" (done ones are faded by the row).
export function dayTime(task, day, now, timeFormat = "12", dateFormat) {
  const due = dueMs(task.dueDate), start = taskStart(task);
  const tone = task.done ? "" : isOverdue(task, now) ? "over" : start !== null && start <= now && now <= due ? "run" : "";
  const endText = hasDueTime(due) ? formatClockShort(new Date(due), timeFormat) : "하루 끝";
  let text;
  if (startOfDay(due) !== startOfDay(day)) text = `~${shortDate(due, now, dateFormat)}`;
  else if (start === null || !hasStartTime(start)) text = start === null ? endText : `~${endText}`;
  else if (startOfDay(start) !== startOfDay(due)) text = `~${endText}`;
  else text = hasDueTime(due) ? clockRange(start, due, timeFormat) : `${formatClockShort(new Date(start), timeFormat)} ~ 하루 끝`;
  return { text, tone };
}

// The picked day's list (#102 mock dayList): the header with the open count, then each task with
// the category mark and the name taking the room left, its time (dayTime) small at the row's right
// end (#111; the shield when any of its categories is secret). Clicking opens its detail;
// right-click opens the task menu.
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
        {longDate(d, today)} ({WEEKDAYS[d.getDay()]}){pickedDay === today ? " · 오늘" : ""}
        <span>{left}개 남음</span>
      </div>
      <div className="rp-box rp-agenda" role="list" aria-label="이날 할 일">
        {list.length ? list.map((task) => {
          const first = markCategory(catsOf?.(task) ?? []);
          const time = dayTime(task, pickedDay, minute * 60000, tf, prefs);
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
              {first?.secret ? (
                <span className="rp-shield" style={{ color: categoryColor(first) }} role="img" aria-label="비밀 카테고리"><ShieldIcon size={11} /></span>
              ) : (
                <span className="rp-dot" style={{ background: first ? categoryColor(first) : "var(--faint)" }} />
              )}
              <span className="rp-nm">{task.title}</span>
              <span className={"rp-tm" + (time.tone ? ` ${time.tone}` : "")}>{time.text}</span>
            </div>
          );
        }) : <div className="rp-none">이날은 할 일이 없어요</div>}
      </div>
    </>
  );
}

// 캘린더 tab (#102 mock calendarBody): the mini month (today ring, picked day filled, dots for
// days with open tasks, the other days the timeline shows tinted, #110) above the picked day's
// list. The picked day is shared with the calendar
// view (usePickedDay).
export default function CalendarTab(props) {
  const { tasks, prefs } = props;
  const { pickedDay, setPickedDay, shownDays = 0 } = usePickedDay();
  const shownRange = shownDays > 1 ? [pickedDay, new Date(pickedDay).setDate(new Date(pickedDay).getDate() + shownDays - 1)] : null;
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
          shownRange={shownRange}
        />
      </div>
      <DayList {...props} />
    </>
  );
}
