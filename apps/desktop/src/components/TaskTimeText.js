import { shallowEqual, useSelector } from "react-redux";
import useClock from "hooks/UseClock";
import { prefsSelector } from "store/prefsSlice";
import { formatTaskTime, timeDisplayOptions } from "utils/timeDisplay";

// The time on a task line, as chosen in 설정 > 일반 > 시간 표시 (#101).
// Re-renders only when its own text changes.
const TaskTimeText = ({ dueDate, className = "", title }) => {
  const options = useSelector((state) => timeDisplayOptions(prefsSelector(state)), shallowEqual);
  const due = new Date(dueDate).valueOf();
  const text = useClock((now) => formatTaskTime(due, now, options));
  return <span className={className} title={title}>{text}</span>;
};

export default TaskTimeText;
