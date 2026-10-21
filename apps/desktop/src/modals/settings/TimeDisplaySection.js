import { useId, useState } from "react";
import { IoRepeat, IoStar, IoStarOutline } from "react-icons/io5";
import useClock from "hooks/UseClock";
import { formatTaskTimes, timeDisplayExamples, timeDisplayOptions } from "utils/timeDisplay";
import { Toggle } from "./SettingsUI";
import "./TimeDisplaySection.scss";

const DUE_CHOICES = [
  { value: "group", label: "묶음 맞춤", tag: "새 기본값" },
  { value: "simple", label: "간단히" },
  { value: "auto", label: "자동" },
  { value: "exact", label: "정확히" },
  { value: "full", label: "자세히" },
];
const REMAIN_CHOICES = [
  { value: "simple", label: "간단히" },
  { value: "normal", label: "보통" },
  { value: "detailed", label: "자세히" },
  { value: "all", label: "모두" },
];

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

// Synthetic tasks for the preview, due relative to when the page opened.
function previewTasks(base) {
  return [
    { id: "report", title: "주간 보고서 제출", due: base - (3 * HOUR + 40 * MINUTE + 2 * SECOND),
      category: { title: "업무", color: "#6294ff" } },
    { id: "review", title: "분기 회고 자료 정리", due: base + 2 * HOUR + 59 * MINUTE + 55 * SECOND,
      category: { title: "업무", color: "#6294ff" }, important: true, subtasks: "2/3" },
    { id: "workout", title: "운동 30분", due: base + DAY + 4 * HOUR + 12 * MINUTE + 8 * SECOND,
      category: { title: "생활", color: "#44c98b" }, repeat: "매일" },
  ];
}

// A list row reduced to what the setting changes: the right column, due on top and the
// remaining time below.
const PreviewRow = ({ task, options }) => {
  // useClock needs primitive results, so each part is read on its own.
  const due = useClock((now) => formatTaskTimes(task.due, now, options).due);
  const remain = useClock((now) => formatTaskTimes(task.due, now, options).remain);
  const overdue = useClock((now) => task.due < now);
  return (
    <div className="time-preview__row">
      <span className="time-preview__check" />
      <div className="time-preview__text">
        <div className="time-preview__title">{task.title}</div>
        <div className="time-preview__meta">
          <span><i className="time-preview__dot" style={{ background: task.category.color }} />{task.category.title}</span>
          {task.repeat && <span><IoRepeat />{task.repeat}</span>}
          {task.subtasks && <span>{task.subtasks}</span>}
        </div>
      </div>
      <div className="time-preview__times">
        <span className={"time-preview__due" + (overdue ? " overdue" : "")}>{due}</span>
        {remain && <span className={"time-preview__remain" + (overdue ? " overdue" : "")}>{remain}</span>}
      </div>
      <span className={"time-preview__star" + (task.important ? " on" : "")}>
        {task.important ? <IoStar /> : <IoStarOutline />}
      </span>
    </div>
  );
};

const ChoiceGroup = ({ label, choices, current, kind, today, timeFormat, onPick }) => {
  const id = useId();
  return (
    <div className="time-display__choices" role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <button key={choice.value} type="button" role="radio" aria-checked={current === choice.value}
          aria-label={choice.label} aria-describedby={`${id}-${choice.value}`}
          className={"time-display__choice" + (current === choice.value ? " time-display__choice--on" : "")}
          onClick={() => onPick(choice.value)}>
          <span className="time-display__radio" aria-hidden="true" />
          <span className="time-display__name">
            {choice.label}
            {choice.tag && <em className="time-display__tag">{choice.tag}</em>}
          </span>
          <span className="time-display__examples" id={`${id}-${choice.value}`}>
            {timeDisplayExamples(kind, choice.value, today, timeFormat)}
          </span>
        </button>
      ))}
    </div>
  );
};

// 설정 > 일반 > 시간 표시 (#101, #102): how the task list's right column words the due and the
// remaining time, and whether the remaining time shows (also in the list's view menu).
const TimeDisplaySection = ({ prefs, set }) => {
  const options = timeDisplayOptions(prefs);
  const { showRemain, remainFormat, dueFormat, timeFormat } = options;
  const [preview] = useState(() => previewTasks(Date.now()));
  // Examples depend only on today's date.
  const today = useClock((now) => new Date(now).setHours(0, 0, 0, 0));

  return (
    <div className="time-display">
      <div className="settings-row__text">
        <div className="settings-row__label">시간 표시</div>
        <div className="settings-row__desc">할 일 목록 오른쪽 칸 위에는 기한, 아래에는 남은 시간을 연하게 보여 줘요.</div>
      </div>
      <div className="time-display__label">미리 보기</div>
      <div className="time-display__preview time-preview" aria-hidden="true">
        {preview.map((task) => <PreviewRow key={task.id} task={task} options={options} />)}
      </div>
      <div className="time-display__label">기한</div>
      <ChoiceGroup label="기한 표시 방식" choices={DUE_CHOICES} current={dueFormat} kind="due"
        today={today} timeFormat={timeFormat} onPick={(value) => set({ dueFormat: value })} />
      <div className="time-display__label time-display__label--switch">
        남은 시간
        <span className="time-display__switch">
          <Toggle label="남은 시간 보이기" checked={showRemain} onChange={(value) => set({ showRemain: value })} />
          <span aria-hidden="true">보이기</span>
        </span>
      </div>
      <ChoiceGroup label="남은 시간 표시 방식" choices={REMAIN_CHOICES} current={remainFormat} kind="remain"
        today={today} timeFormat={timeFormat} onPick={(value) => set({ remainFormat: value })} />
    </div>
  );
};

export default TimeDisplaySection;
