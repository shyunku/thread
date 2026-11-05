import "./UndoNotice.scss";
import { createPortal } from "react-dom";
import { objectParticle } from "molecules/pickers";
import { TickIcon, TrashIcon } from "molecules/pickers/icons";

const VERB = { done: "완료했어요", del: "지웠어요" };
const ICON = {
  done: <TickIcon size={14} strokeWidth={2.4} />,
  del: <TrashIcon size={15} />,
};
// Names past 22 characters end in … (the particle still follows the whole name).
const NAME_MAX = 22;
// Counted by characters, so an emoji is never cut in half.
export const shortName = (name) => {
  const chars = Array.from(name);
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join("").trimEnd()}…` : name;
};

// The undo notice (#107.11, mock .undo-toast): top center below the title bar, "'<name>'을
// 완료했어요" with 되돌리기 (Ctrl+Z) and a bar that drains over the 5 s it stays. It lives in
// body, over the panels and below popups and dialogs. `notice` comes from useUndoNotice.
export default function UndoNotice({ notice, onUndo }) {
  if (!notice) return null;
  const { kind, name, canUndo, leaving } = notice;
  return createPortal(
    <div key={notice.seq} className={`main-scope no-auto-hover undo-notice ${leaving ? "out" : "in"}`} role="status" aria-live="polite">
      <span className={`un-i ${kind}`}>{ICON[kind]}</span>
      <span className="un-msg">
        '<b className="un-nm">{shortName(name)}</b>'{objectParticle(name)}&nbsp;{VERB[kind]}
      </span>
      {canUndo && (
        <button type="button" className="un-btn" aria-label="되돌리기" aria-keyshortcuts="Control+Z" onClick={onUndo} disabled={leaving}>
          되돌리기<kbd>Ctrl Z</kbd>
        </button>
      )}
      <i className="un-bar" aria-hidden="true" />
    </div>,
    document.body
  );
}
