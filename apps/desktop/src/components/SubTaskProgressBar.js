import { IoCheckmark } from "react-icons/io5";
import "./SubTaskProgressBar.scss";

const SubTaskProgressBar = ({
  fulfilled = 0,
  total = 0,
  done = false,
  doneHandler,
}) => (
  <div className={"subtask-progress-bar-wrapper" + (done ? " done" : "")}>
    <button
      type="button"
      className="completion-toggle"
      role="checkbox"
      aria-checked={!!done}
      aria-label={done ? "완료 취소" : "할 일 완료"}
      title={
        total > 0
          ? `하위 작업 ${fulfilled}/${total} 완료`
          : done
          ? "완료 취소"
          : "할 일 완료"
      }
      onClick={(event) => {
        event.stopPropagation();
        doneHandler?.(!done);
      }}
    >
      {done && <IoCheckmark />}
    </button>
    {total > 0 && (
      <span className="subtask-fraction">
        {fulfilled}/{total}
      </span>
    )}
  </div>
);
export default SubTaskProgressBar;
