import "./Clock.scss";
import useClock from "hooks/UseClock";
import { useTimeFormat } from "utils/timeFormat";
import { formatClock } from "utils/timeDisplay";

const WEEKDAYS = "일월화수목금토";
const pad = (n) => String(n).padStart(2, "0");

// Sidebar clock (#102): "2026년 10월 21일 수요일", the time large with small seconds; the
// icon rail shows a compact two-line time. Follows 설정 > 시각 형식 (12/24h).
const Clock = ({ compact = false }) => {
  const second = useClock((now) => Math.floor(now / 1000));
  const timeFormat = useTimeFormat();
  const date = new Date(second * 1000);
  const time = formatClock(date, timeFormat);
  if (compact) {
    const [half, clock] = timeFormat === "24" ? [null, time] : time.split(" ");
    return (
      <div className="side-clock rail" aria-label={`${half ? half + " " : ""}${clock}`}>
        <span className="cr">
          {half && (
            <>
              {half}
              <br />
            </>
          )}
          {clock}
        </span>
      </div>
    );
  }
  return (
    <div className="side-clock">
      <span className="cd">
        {date.getFullYear()}년 {date.getMonth() + 1}월 {date.getDate()}일 {WEEKDAYS[date.getDay()]}요일
      </span>
      <b>
        {time}
        <small>:{pad(date.getSeconds())}</small>
      </b>
    </div>
  );
};

export default Clock;
