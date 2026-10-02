import { useEffect, useRef, useState } from "react";
import { VscCheck, VscCopy } from "react-icons/vsc";
import { SettingsButton } from "../SettingsUI";
import { osAuthLabel } from "./format";
import "./StepDialog.scss";

// Child dialog for multi-step data tasks, shown over the settings window.
export default function StepDialog({ title, step = 1, total = 1, stepLabel, children, footer, onClose, closable = true }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("button:not(:disabled), input:not(:disabled)")?.focus();
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (closable) onClose?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [closable, onClose]);
  return (
    <div className="step-dialog__scrim">
      <div className="step-dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="step-dialog__head">
          <h3>{title}</h3>
          {total > 1 && (
            <>
              <ol className="step-dialog__steps" aria-hidden="true">
                {Array.from({ length: total }, (_, index) => (
                  <li key={index} className={index < step - 1 ? "done" : index === step - 1 ? "current" : ""} />
                ))}
              </ol>
              <div className="step-dialog__label">{step}/{total}{stepLabel ? ` · ${stepLabel}` : ""}</div>
            </>
          )}
        </header>
        <div className="step-dialog__body">{children}</div>
        {footer && <footer className="step-dialog__foot">{footer}</footer>}
      </div>
    </div>
  );
}

// Primary re-authentication action: OS authentication by default, password as fallback.
export function AuthAction({ osAvailable, verb, busy = false, disabled = false, onRun }) {
  const [usePassword, setUsePassword] = useState(!osAvailable);
  const chosen = useRef(false);
  const password = useRef(null);
  // Vault status may arrive after the dialog opens; follow it unless the user already chose.
  useEffect(() => { if (!chosen.current) setUsePassword(!osAvailable); }, [osAvailable]);
  const run = () => {
    const value = password.current?.value;
    if (password.current) password.current.value = "";
    onRun(usePassword ? { method: "password", password: value } : { method: "os" });
  };
  return (
    <div className="auth-action">
      {usePassword && (
        <input ref={password} className="step-dialog__input auth-action__password" type="password" aria-label="비밀번호"
          placeholder="비밀번호" autoComplete="off" maxLength={1024} disabled={busy}
          onKeyDown={(event) => { if (event.key === "Enter" && !busy && !disabled) run(); }} />
      )}
      {osAvailable && (
        <SettingsButton variant="ghost" className="auth-action__switch" disabled={busy} onClick={() => { chosen.current = true; setUsePassword((value) => !value); }}>
          {usePassword ? `${osAuthLabel()} 사용` : "비밀번호 사용"}
        </SettingsButton>
      )}
      <SettingsButton variant="primary" disabled={busy || disabled} onClick={run}>
        {busy ? "확인 중…" : usePassword ? `비밀번호로 ${verb}` : `${osAuthLabel()}로 ${verb}`}
      </SettingsButton>
    </div>
  );
}

export function Code({ children, size = "large" }) {
  return <div className={"step-dialog__code step-dialog__code--" + size}>{children}</div>;
}

// Code box with an inline copy button. For secret codes pass clearAfterMs: the clipboard is
// emptied later if it still holds this code (like main's 30-second recovery code helper).
export function CopyableCode({ value, display, label = "복사", clearAfterMs = 0 }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); return; }
    if (!clearAfterMs) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { if ((await navigator.clipboard.readText()) === value) await navigator.clipboard.writeText(""); } catch { /* clipboard read not allowed */ }
    }, clearAfterMs);
  };
  return (
    <div className="step-dialog__copyable">
      <span className="step-dialog__copyable-text">{display ?? value}</span>
      <button type="button" className="step-dialog__copy" disabled={!value} onClick={copy} aria-label={copied ? "복사했어요" : label} title={copied ? "복사했어요" : label}>
        {copied ? <VscCheck aria-hidden="true" /> : <VscCopy aria-hidden="true" />}
      </button>
    </div>
  );
}

export function Callout({ tone = "warning", children }) {
  return <div className={"step-dialog__callout step-dialog__callout--" + tone}>{children}</div>;
}
