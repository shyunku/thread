import { useId, useState } from "react";
import { IoStar, IoStarOutline } from "react-icons/io5";
import SubTaskProgressBar from "components/SubTaskProgressBar";
import TaskTimeText from "components/TaskTimeText";
import useClock from "hooks/UseClock";
import { SelectedDayTask, sortByDue } from "views/TaskCalendarView";
import { timeDisplayExamples, timeDisplayOptions } from "utils/timeDisplay";
import { Segmented } from "./SettingsUI";
import "components/TodoItem.scss";
import "./TimeDisplaySection.scss";

const REMAIN_CHOICES = [
  { value: "simple", label: "간단히" },
  { value: "normal", label: "보통" },
  { value: "detailed", label: "자세히" },
  { value: "all", label: "모두" },
];
const DUE_CHOICES = [
  { value: "simple", label: "간단히" },
  { value: "auto", label: "자동" },
  { value: "exact", label: "정확히" },
  { value: "full", label: "자세히" },
];

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

// Synthetic tasks for the preview, due relative to when the page opened.
function previewTasks(base) {
  return {
    rows: [
      { id: "review", title: "분기 회고 자료 정리", dueDate: base + 2 * HOUR + 59 * MINUTE + 55 * SECOND,
        category: { title: "업무", color: "#6294ff" }, important: true, subtasks: [2, 3] },
      { id: "workout", title: "운동 30분", dueDate: base + DAY + 4 * HOUR + 12 * MINUTE + 8 * SECOND,
        category: { title: "생활", color: "#44c98b" }, repeat: "매일" },
    ],
    day: [
      { id: "review", title: "분기 회고 자료 정리", dueDate: base + 2 * HOUR + 59 * MINUTE + 55 * SECOND, done: false },
      { id: "report", title: "주간 보고서 제출", dueDate: base - (3 * HOUR + 40 * MINUTE + 2 * SECOND), done: false },
    ],
  };
}

// "10월 7일 (수)" like the calendar, without depending on moment's locale being loaded.
const dayTitle = (time) => {
  const date = new Date(time);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${"일월화수목금토"[date.getDay()]})`;
};

// Same markup and classes as a collapsed TodoItem, without its actions.
const PreviewRow = ({ task }) => {
  const overdue = useClock((now) => task.dueDate < now);
  const meta = [<TaskTimeText key="time" dueDate={task.dueDate} className="remain-time" />];
  if (task.repeat) meta.push(<span key="repeat" className="repeat">↻ {task.repeat}</span>);
  if (task.subtasks) meta.push(<span key="subtasks" className="subtask-count">{task.subtasks.join("/")}</span>);
  return (
    <div className={"todo-item-wrapper" + (overdue ? " overdue" : "")}>
      <div>
        <div className="todo-item">
          <div className="left-side">
            <SubTaskProgressBar total={task.subtasks?.[1] ?? 0} fulfilled={task.subtasks?.[0] ?? 0} />
            <div className="text">
              <div className="title-line">
                <div className="title">{task.title}</div>
              </div>
              <div className="meta">
                <span className="task-category-badge" style={{ color: task.category.color, backgroundColor: `${task.category.color}26` }}>
                  {task.category.title}
                </span>
                {meta.map((item, i) => [i > 0 && <span key={`sep-${i}`} className="separator">·</span>, item])}
              </div>
            </div>
          </div>
          <span className={"star-button" + (task.important ? " on" : "")}>
            {task.important ? <IoStar /> : <IoStarOutline />}
          </span>
        </div>
      </div>
    </div>
  );
};

// 설정 > 일반 > 시간 표시 (#101): what task lines show and how detailed, with a live preview.
const TimeDisplaySection = ({ prefs, set }) => {
  const id = useId();
  const { timeDisplay, remainFormat, dueFormat, timeFormat } = timeDisplayOptions(prefs);
  const remain = timeDisplay === "remain";
  const choices = remain ? REMAIN_CHOICES : DUE_CHOICES;
  const current = remain ? remainFormat : dueFormat;
  const [preview] = useState(() => previewTasks(Date.now()));
  // Examples depend only on today's date.
  const today = useClock((now) => new Date(now).setHours(0, 0, 0, 0));
  const description = `할 일 목록과 캘린더 아래 목록에 ${remain ? "남은 시간" : "기한"}을 얼마나 자세히 보여 줄지 정해요.`;

  return (
    <div className="time-display">
      <div className="time-display__head">
        <div className="settings-row__text">
          <div className="settings-row__label">시간 표시</div>
          <div className="settings-row__desc">{description}</div>
        </div>
        <Segmented label="시간 표시" value={timeDisplay} onChange={(value) => set({ timeDisplay: value })}
          options={[{ value: "remain", label: "남은 시간" }, { value: "due", label: "기한" }]} />
      </div>
      <div className="time-display__label">미리 보기</div>
      <div className="time-display__preview" aria-hidden="true">
        <div className="time-display__rows">
          {preview.rows.map((task) => <PreviewRow key={task.id} task={task} />)}
        </div>
        <div className="task-view calendar time-display__day">
          <section className="selected-day">
            <h3>{dayTitle(today)}</h3>
            {sortByDue(preview.day).map((task) => <SelectedDayTask key={task.id} task={task} />)}
          </section>
        </div>
      </div>
      <div className="time-display__choices" role="radiogroup" aria-label={remain ? "남은 시간 표시 방식" : "기한 표시 방식"}>
        {choices.map((choice) => (
          <button key={choice.value} type="button" role="radio" aria-checked={current === choice.value}
            aria-label={choice.label} aria-describedby={`${id}-${choice.value}`}
            className={"time-display__choice" + (current === choice.value ? " time-display__choice--on" : "")}
            onClick={() => set(remain ? { remainFormat: choice.value } : { dueFormat: choice.value })}>
            <span className="time-display__radio" aria-hidden="true" />
            <span className="time-display__name">{choice.label}</span>
            <span className="time-display__examples" id={`${id}-${choice.value}`}>
              {timeDisplayExamples(timeDisplay, choice.value, today, timeFormat)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default TimeDisplaySection;
