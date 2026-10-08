import moment from "moment";
import { useSelector } from "react-redux";
import { prefsSelector } from "store/prefsSlice";
import { useEffect, useMemo, useRef, useState } from "react";
import { IoPlay, IoPlayBack, IoPlayForward } from "react-icons/io5";
import { fastInterval, fromRelativeTime } from "utils/Common";
import JsxUtil from "utils/JsxUtil";
import TaskTimeText from "components/TaskTimeText";
import useClock from "hooks/UseClock";
import "./TaskCalendarView.scss";

// Selected-day list order (#101): least time left first, so overdue on top; no due date last.
export function sortByDue(tasks) {
  const dueOf = (task) => (task.dueDate == null ? Infinity : moment(task.dueDate).valueOf());
  return [...tasks].sort((a, b) => {
    const da = dueOf(a), db = dueOf(b);
    return da === db ? 0 : da < db ? -1 : 1;
  });
}

const TaskCalendarView = ({
  taskMap,
  filteredTaskMap,
  setHoveredTaskId: sharedSetHoveredTaskId,
  hoveredTaskId: sharedHoveredTaskId,
  categories,
}) => {
  // In the split view the list shares hover with this calendar; alone, it keeps its own.
  const [localHoveredTaskId, setLocalHoveredTaskId] = useState(null);
  const setHoveredTaskId = sharedSetHoveredTaskId ?? setLocalHoveredTaskId;
  const hoveredTaskId = sharedSetHoveredTaskId ? sharedHoveredTaskId : localHoveredTaskId;
  const [currentDate, setCurrentDate] = useState(new Date());
  const [watchingMonth, setWatchingMonth] = useState(new Date());
  const [hoveredDate, setHoveredDate] = useState(null);
  const [selectedDate, setSelectedDate] = useState(moment().format("YYYY-M-D"));

  const dateTaskMap = useMemo(() => {
    const dateMap = {};
    for (let tid in filteredTaskMap) {
      if (filteredTaskMap[tid].dueDate == null) continue;
      const dayDateKey = moment(filteredTaskMap[tid].dueDate).format(
        "YYYY-M-D"
      );
      if (dateMap[dayDateKey] == null) dateMap[dayDateKey] = [];
      dateMap[dayDateKey].push(filteredTaskMap[tid]);
    }
    return dateMap;
  }, [filteredTaskMap]);

  const selectedDayTasks = useMemo(() => sortByDue(dateTaskMap[selectedDate] || []), [dateTaskMap, selectedDate]);

  const currentMoment = useMemo(() => {
    return moment(currentDate);
  }, [currentDate]);
  const watchingMoment = useMemo(() => {
    return moment(watchingMonth);
  }, [watchingMonth]);

  const prevMonthLastDate = useMemo(() => {
    return new Date(watchingMonth.getFullYear(), watchingMonth.getMonth(), 0);
  }, [watchingMonth]);
  const curMonthFirstDay = useMemo(() => {
    return new Date(
      watchingMonth.getFullYear(),
      watchingMonth.getMonth(),
      1
    ).getDay();
  }, [watchingMonth]);
  // 설정 > 일반 > 주 시작 요일 (0 = Sunday, 1 = Monday)
  const weekStart = useSelector(prefsSelector).weekStart === 1 ? 1 : 0;
  const leadingDays = (curMonthFirstDay - weekStart + 7) % 7;
  const curMonthLastDate = useMemo(() => {
    return new Date(
      watchingMonth.getFullYear(),
      watchingMonth.getMonth() + 1,
      0
    );
  }, [watchingMonth]);

  useEffect(() => {
    const interval = fastInterval(() => {
      setCurrentDate(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // At midnight a selection that was "today" follows to the new day (and its month).
  const todayKey = currentMoment.format("YYYY-M-D");
  const lastTodayKey = useRef(todayKey);
  useEffect(() => {
    const previous = lastTodayKey.current;
    if (previous === todayKey) return;
    lastTodayKey.current = todayKey;
    if (selectedDate !== previous) return;
    setSelectedDate(todayKey);
    if (moment(watchingMonth).isSame(moment(previous, "YYYY-M-D"), "month")) setWatchingMonth(new Date());
  }, [todayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPrevYear = () => {
    setWatchingMonth(
      new Date(watchingMonth.getFullYear() - 1, watchingMonth.getMonth(), 1)
    );
  };

  const onPrevMonth = () => {
    setWatchingMonth(
      new Date(watchingMonth.getFullYear(), watchingMonth.getMonth() - 1, 1)
    );
  };

  const onCurrentMonth = () => {
    setWatchingMonth(new Date());
  };

  const onNextMonth = () => {
    setWatchingMonth(
      new Date(watchingMonth.getFullYear(), watchingMonth.getMonth() + 1, 1)
    );
  };

  const onNextYear = () => {
    setWatchingMonth(
      new Date(watchingMonth.getFullYear() + 1, watchingMonth.getMonth(), 1)
    );
  };

  return (
    <div className="task-view calendar">
      <div className="calendar-view">
        <div className="calendar-view-header view-header">
          <div className="current-year-month">
            {watchingMoment.format("YYYY년 M월")}
          </div>
          <div className="options">
            <button className="option ltr" aria-label="이전 연도" title="이전 연도" onClick={onPrevYear}>
              <div className="icon-wrapper">
                <IoPlayBack />
              </div>
            </button>
            <button className="option ltr" aria-label="이전 달" title="이전 달" onClick={onPrevMonth}>
              <div className="icon-wrapper">
                <IoPlay style={{ transform: `rotate(180deg)` }} />
              </div>
            </button>
            <button className="option" onClick={onCurrentMonth}>
              <div className="label">오늘</div>
            </button>
            <button className="option rtl" aria-label="다음 달" title="다음 달" onClick={onNextMonth}>
              <div className="icon-wrapper">
                <IoPlay />
              </div>
            </button>
            <button className="option rtl" aria-label="다음 연도" title="다음 연도" onClick={onNextYear}>
              <div className="icon-wrapper">
                <IoPlayForward />
              </div>
            </button>
          </div>
        </div>
        <div className="calendar-view-body">
          <div className="week-cells">
            {Array(7)
              .fill(0)
              .map((_, index) => {
                const dayIndex = (weekStart + index) % 7;
                return (
                  <div
                    className={
                      "week-cell cell" +
                      JsxUtil.classByCondition(
                        hoveredDate?.getDay() == dayIndex,
                        "focused"
                      ) +
                      JsxUtil.classByCondition(dayIndex == 0, "sunday") +
                      JsxUtil.classByCondition(dayIndex == 6, "saturday")
                    }
                    key={index}
                  >
                    {moment().day(dayIndex).format("dd")}
                  </div>
                );
              })}
          </div>
          <div className="day-cells">
            {Array(leadingDays)
              .fill(0)
              .map((_, index) => (
                <DayCell
                  key={index}
                  year={watchingMoment.year()}
                  month={watchingMoment.month() - 1}
                  selectedDate={selectedDate} onDateSelect={setSelectedDate}
                  day={
                    moment(prevMonthLastDate).date() -
                    leadingDays +
                    index +
                    1
                  }
                  currentMoment={currentMoment}
                  dateTaskMap={dateTaskMap}
                  setHoveredTaskId={setHoveredTaskId}
                  hoveredTaskId={hoveredTaskId}
                  categories={categories}
                />
              ))}
            {Array(curMonthLastDate.getDate())
              .fill(0)
              .map((_, index) => (
                <DayCell
                  key={index}
                  year={watchingMoment.year()}
                  month={watchingMoment.month()}
                  selectedDate={selectedDate} onDateSelect={setSelectedDate}
                  day={index + 1}
                  currentMoment={currentMoment}
                  dateTaskMap={dateTaskMap}
                  currentMonth={true}
                  setHoveredTaskId={setHoveredTaskId}
                  hoveredTaskId={hoveredTaskId}
                  categories={categories}
                />
              ))}
            {(weekStart + 6 - curMonthLastDate.getDay()) % 7 > 0 &&
              Array((weekStart + 6 - curMonthLastDate.getDay()) % 7)
                .fill(0)
                .map((_, index) => (
                  <DayCell
                    key={index}
                    year={watchingMoment.year()}
                    month={watchingMoment.month() + 1}
                    selectedDate={selectedDate} onDateSelect={setSelectedDate}
                    day={index + 1}
                    currentMoment={currentMoment}
                    dateTaskMap={dateTaskMap}
                    setHoveredTaskId={setHoveredTaskId}
                    hoveredTaskId={hoveredTaskId}
                    categories={categories}
                  />
                ))}
          </div>
        </div>
      </div>
      <section className="selected-day" aria-label="선택한 날짜의 할 일">
        <h3>{moment(selectedDate, "YYYY-M-D").format("M월 D일 (ddd)")}</h3>
        {selectedDayTasks.length === 0
          ? <p>등록된 할 일이 없어요. 여유로운 하루를 계획해보세요.</p>
          : selectedDayTasks.map((task) => (
            <SelectedDayTask key={task.id} task={task}
              hovered={hoveredTaskId === task.id} setHoveredTaskId={setHoveredTaskId} />
          ))}
      </section>
    </div>
  );
};

export const SelectedDayTask = ({ task, hovered, setHoveredTaskId }) => {
  const dueAt = task.dueDate == null ? null : moment(task.dueDate).valueOf();
  const overdue = useClock((now) => dueAt != null && dueAt < now);
  return (
    <div
      className={"selected-day-task" + JsxUtil.classByCondition(task.done, "done") +
        JsxUtil.classByCondition(hovered, "hovered")}
      onMouseEnter={() => setHoveredTaskId?.(task.id)}
      onMouseLeave={() => setHoveredTaskId?.(null)}
    >
      <span className={task.done ? "done-dot" : "task-dot"} />
      <span className="selected-day-task__title">{task.title}</span>
      {dueAt != null && (
        <TaskTimeText dueDate={dueAt}
          className={"selected-day-task__time" + JsxUtil.classByCondition(overdue && !task.done, "overdue")} />
      )}
    </div>
  );
};

const DayCell = ({
  currentMoment,
  year,
  month,
  day,
  dateTaskMap,
  currentMonth = false,
  selectedDate,
  onDateSelect,
  setHoveredTaskId,
  hoveredTaskId,
  categories,
  ...rest
}) => {
  const cellDate = useMemo(() => {
    return moment(new Date(year, month, day));
  }, [year, month, day]);
  const isToday = useMemo(() => {
    return cellDate.isSame(currentMoment, "day");
  }, [cellDate, currentMoment]);
  const isSunday = useMemo(() => {
    return cellDate.day() === 0;
  }, [cellDate]);
  const isSaturday = useMemo(() => {
    return cellDate.day() === 6;
  }, [cellDate]);

  const dateKey = `${year}-${month + 1}-${day}`;
  const tasks = dateTaskMap[dateKey] || [];

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (a.done && !b.done) return 1;
      if (!a.done && b.done) return -1;

      const aMoment = moment(a.dueDate);
      const bMoment = moment(b.dueDate);
      if (aMoment.isBefore(bMoment)) return -1;
      if (aMoment.isAfter(bMoment)) return 1;
      return 0;
    });
  }, [tasks]);

  return (
    <div
      role="button" tabIndex={0} aria-label={cellDate.format("YYYY년 M월 D일")} aria-pressed={selectedDate === dateKey}
      onClick={() => onDateSelect(dateKey)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onDateSelect(dateKey); } }}
      className={
        "day-cell cell" +
        JsxUtil.classByCondition(selectedDate === dateKey, "selected") +
        JsxUtil.classByCondition(isToday, "today") +
        JsxUtil.classByCondition(currentMonth, "current-month") +
        JsxUtil.classByCondition(isSunday, "sunday") +
        JsxUtil.classByCondition(isSaturday, "saturday")
      }
      {...rest}
    >
      <div className="day-cell-header">
        <div className="date">{day}</div>
        {sortedTasks.length > 0 && (
          <div className="task-count">{sortedTasks.length}개 항목</div>
        )}
      </div>
      <div className="tasks scroll-visible">
        {sortedTasks.map((task) => {
          return (
            <TaskCell
              task={task}
              key={task.id}
              setHoveredTaskId={setHoveredTaskId}
              hoveredTaskId={hoveredTaskId}
              categories={categories}
            />
          );
        })}
      </div>
    </div>
  );
};

const TaskCell = ({ task, setHoveredTaskId, hoveredTaskId, categories }) => {
  const [counter, setCounter] = useState(0);

  const dueDate = useMemo(() => {
    if (task.dueDate == null) return null;
    return moment(task.dueDate).toDate();
  }, [task.dueDate]);

  const overDue = useMemo(() => {
    if (dueDate == null) return false;
    return dueDate.valueOf() < Date.now();
  }, [dueDate, counter]);

  const subtasks = useMemo(() => {
    return Object.values(task.subtasks ?? {});
  });

  const remainMilliSeconds = useMemo(() => {
    if (dueDate == null) {
      return null;
    }
    const remain = dueDate.valueOf() - Date.now();
    return remain;
  }, [dueDate, counter]);

  const remainTimeText = useMemo(() => {
    if (dueDate == null) {
      return "미정";
    }
    return fromRelativeTime(
      remainMilliSeconds < 0 ? -remainMilliSeconds : remainMilliSeconds,
      {
        showLayerCount: 1,
        showMillisec: false,
      }
    );
  }, [dueDate, counter]);

  const categoryColor = useMemo(() => {
    for (let cid in categories) {
      if (task.categories.hasOwnProperty(cid)) {
        const category = categories[cid];
        if (category.color != null) {
          return category.color;
        }
      }
    }
    return null;
  }, [categories]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCounter((c) => c + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={
        "task" +
        JsxUtil.classByCondition(task.done, "done") +
        JsxUtil.classByEqual(hoveredTaskId, task.id, "hovered") +
        JsxUtil.classByCondition(overDue, "overdue")
      }
      key={task.id}
      onMouseEnter={() => setHoveredTaskId?.(task.id)}
      onMouseLeave={() => setHoveredTaskId?.(null)}
    >
      <div
        className={"color-label"}
        style={{ backgroundColor: categoryColor }}
      ></div>
      <div className="title">{task.title}</div>
      {subtasks.length > 0 && (
        <div className="subtasks">
          ({task.getFulfilledSubTaskCount()}/{subtasks.length})
        </div>
      )}
      {dueDate != null && !task.done && remainMilliSeconds != null && (
        <div className="remain-time">
          {remainTimeText}
          {remainMilliSeconds < 0 ? " 지남" : ""}
        </div>
      )}
    </div>
  );
};

export default TaskCalendarView;
