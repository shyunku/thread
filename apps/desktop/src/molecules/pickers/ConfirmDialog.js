import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldIcon, TrashIcon } from "./icons";
import { DIALOG_Z, stopEvents, trapTab } from "./Popover";
import { usePopupLayer } from "./popupStack";
import "./pickers.scss";

const elementOf = (value) => (value && "current" in value ? value.current : value);
const composing = (event) => event.nativeEvent?.isComposing || event.keyCode === 229;

// The tile icons of the mock's dialogs: the trash (26px, danger red) for deletes, the shield
// (28px, the category colour) for secret categories. `icon` may also be any node.
function tileIcon(icon, size) {
  if (icon === "trash") return <TrashIcon size={size ?? 26} />;
  if (icon === "shield") return <ShieldIcon size={size ?? 28} />;
  return icon;
}

// A modal question of the main screen (#102 mock .hello / confirmDialog()): the Hello unlock,
// the vault password, 삭제할까요? and the secret-category delete with two ways out.
// - choices: 1–2 [{ id, label, note?, danger? }]. One choice sits right of 취소 at the bottom
//   (danger = the mock's .btn.del, else .btn.pri); two stack full width (.cf-c) above 취소.
// - icon: "trash" | "shield" | a node, in the 52px tile; iconColor tints it, iconSize sizes it.
// - input: { type, label, placeholder } adds one field (the vault password). onChoose gets its
//   value; the choices wait for a value; it is wiped when the dialog closes and when a check
//   ends with an `error` (a wrong password).
// - busy: the choices and the field wait (a check is running). error: one line under the text.
// Enter picks `defaultId` (else the first choice) unless focus is on another button; Esc and
// the backdrop cancel. Focus stays inside while it is open and goes back to returnFocus (or
// where it was) when it closes.
export default function ConfirmDialog({
  title, body, choices = [], defaultId, cancelLabel = "취소", icon, iconColor, iconSize,
  input, busy = false, error, onChoose, onCancel, returnFocus,
}) {
  const wrapRef = useRef(null); // the scrim belongs to the dialog for the popups below it
  const ref = useRef(null);
  const defaultRef = useRef(null);
  const inputRef = useRef(null);
  const [value, setValue] = useState("");
  const [opener] = useState(() => document.activeElement);
  const titleId = useId(), bodyId = useId(), errorId = useId();
  usePopupLayer(wrapRef, { onEscape: () => onCancel?.(), zBase: DIALOG_Z });
  const list = choices.slice(0, 2);
  const primary = list.find((c) => c.id === defaultId) || list[0];
  const stacked = list.length > 1;
  const waiting = busy || (input && !value);

  useLayoutEffect(() => {
    (inputRef.current || defaultRef.current || ref.current)?.focus({ preventScroll: true });
    const field = inputRef.current;
    return () => {
      // The typed password leaves the page with the dialog.
      if (field) field.value = "";
      const back = elementOf(returnFocus);
      const target = back?.isConnected ? back : opener;
      if (target?.isConnected && target !== document.body) target.focus({ preventScroll: true });
    };
    // Opening and closing only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A refused password (the check is over and left an error) starts the field over.
  useEffect(() => {
    if (busy || !error || !inputRef.current) return;
    setValue("");
    inputRef.current.focus({ preventScroll: true });
  }, [busy, error]);

  const choose = (choice) => { if (!waiting) onChoose?.(choice.id, input ? value : undefined); };

  const onKeyDown = (event) => {
    if (event.key === "Tab") trapTab(event, ref.current);
    else if (event.key === "Enter") {
      // A focused button answers for itself (native click); Enter while composing Korean
      // finishes the syllable.
      if (event.target instanceof HTMLButtonElement || composing(event)) return;
      event.preventDefault();
      if (primary) choose(primary);
    }
  };

  const cls = (c, base) => `${base}${c.danger ? " danger" : " pri"}`;
  return createPortal(
    <div ref={wrapRef} className="main-scope no-auto-hover tp-dialog-wrap" {...stopEvents()}>
      <div className="tp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }} />
      <div
        ref={ref}
        className="tp-pop tp-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {icon && <div className="tp-dialog-i" style={iconColor ? { color: iconColor } : undefined} aria-hidden="true">{tileIcon(icon, iconSize)}</div>}
        <b id={titleId} className="tp-dialog-t">{title}</b>
        {body && <p id={bodyId} className="tp-dialog-b">{body}</p>}
        {input && (
          <input
            ref={inputRef}
            className="tp-dialog-in"
            type={input.type || "text"}
            value={value}
            placeholder={input.placeholder}
            aria-label={input.label || input.placeholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        {error && <p id={errorId} className="tp-dialog-err" role="alert">{error}</p>}
        {stacked ? (
          <div className="tp-dialog-f stacked">
            {list.map((c) => (
              <button key={c.id} ref={c === primary ? defaultRef : undefined} type="button" className={cls(c, "tp-dbtn")} disabled={waiting} onClick={() => choose(c)}>
                <span>{c.label}</span>
                {c.note && <small>{c.note}</small>}
              </button>
            ))}
            <button type="button" className="tp-dbtn" onClick={() => onCancel?.()}>{cancelLabel}</button>
          </div>
        ) : (
          <div className="tp-dialog-f">
            <button type="button" className="dp-btn" onClick={() => onCancel?.()}>{cancelLabel}</button>
            {list.map((c) => (
              <button key={c.id} ref={c === primary ? defaultRef : undefined} type="button" className={cls(c, "dp-btn")} disabled={waiting} onClick={() => choose(c)}>
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
