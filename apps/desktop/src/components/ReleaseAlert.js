import { useEffect, useRef, useState } from "react";
import { VscArrowDown, VscCheck, VscSync, VscWarning } from "react-icons/vsc";
import IpcSender from "utils/IpcSender";
import "./ReleaseAlert.scss";

// One button updates (#100): download, install and restart. What the dialog says for each
// state of the pending update published by main.
function describe(alert) {
  if (alert.status === "installing") return { icon: <VscSync />, dot: "ready", title: "설치하는 중", text: "잠시 후 Thread가 다시 열려요.", progress: true };
  if (alert.status === "failed" || alert.installFailed) return { icon: <VscWarning />, dot: "failed", title: "업데이트하지 못했어요", text: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.", action: "다시 시도" };
  if (alert.status === "downloading" || (alert.status === "available" && alert.autoInstall)) return alert.autoInstall
    ? { icon: <VscArrowDown />, title: "새 버전을 받는 중", text: "다 받으면 설치하고 Thread를 다시 시작해요.", progress: true, busy: true }
    : { icon: <VscArrowDown />, title: "새 버전을 받는 중", text: "업데이트를 누르면 다 받은 뒤 바로 설치해요.", progress: true, action: "업데이트" };
  if (alert.status === "ready") return { icon: <VscCheck />, dot: "ready", title: "업데이트 준비 완료", text: "설치하고 Thread를 다시 시작해요.", action: "업데이트" };
  return { icon: <VscArrowDown />, title: "업데이트할 수 있어요", text: "새 버전을 받아 설치하고 Thread를 다시 시작해요.", action: "업데이트" };
}

export default function ReleaseAlert() {
  const [alert, setAlert] = useState(null);
  const [open, setOpen] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, [open, alert?.version]);
  // An earlier request's error does not belong to a different pending version.
  useEffect(() => setRequestError(false), [alert?.version]);
  useEffect(() => {
    let active = true;
    const receive = ({ success, data }) => {
      if (active && success) {
        setAlert(data);
        if (!data) setOpen(false);
        else if (data.mandatory) setOpen(true);
      }
    };
    const listener = IpcSender.onAll("release-alert/available", receive);
    // Tray "업데이트 확인" found an update: show the notice even when it is optional.
    const openListener = IpcSender.onAll("release-alert/open", ({ success, data }) => {
      if (active && success && data) { setAlert(data); setOpen(true); }
    });
    IpcSender.releaseAlerts.get(receive);
    const show = () => setOpen(true);
    window.addEventListener("thread:open-update", show);
    return () => {
      active = false;
      IpcSender.off("release-alert/available", listener);
      IpcSender.off("release-alert/open", openListener);
      window.removeEventListener("thread:open-update", show);
    };
  }, []);
  if (!alert || !open) return null;
  const view = describe(alert);
  return (
    <div className="release-alert-backdrop">
      <section
        ref={dialog}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="release-alert-title"
        className="release-alert"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = [
            ...event.currentTarget.querySelectorAll("button:not(:disabled)"),
          ];
          if (!buttons.length) {
            event.preventDefault();
            return;
          }
          const index = buttons.indexOf(document.activeElement);
          event.preventDefault();
          buttons[
            (index + (event.shiftKey ? -1 : 1) + buttons.length) %
              buttons.length
          ].focus();
        }}
      >
        <div className="release-alert__heading">
          <span className="release-alert__symbol" aria-hidden="true">{view.icon}</span>
          <div><span className="release-alert__eyebrow">THREAD UPDATE</span><h2 id="release-alert-title">{alert.mandatory ? "필수 업데이트" : "새 버전이 있습니다"}</h2></div>
        </div>
        <div className="release-alert__version">Thread <strong>{alert.version}</strong></div>
        {alert.mandatory && <p className="release-alert__notice">이 버전은 이전 버전과 호환되지 않습니다. 업데이트 후 계속 사용할 수 있어요.</p>}
        <div className="release-alert__status" role="status">
          <span className={`release-alert__status-dot release-alert__status-dot--${view.dot || alert.status}`} aria-hidden="true" />
          <div className="release-alert__status-text">
            <strong>{view.title}</strong>
            <p>{view.text}</p>
            {view.progress && <div className="release-alert__progress" aria-hidden="true"><i /></div>}
          </div>
        </div>
        {requestError && <p className="release-alert__error" role="alert">업데이트를 시작하지 못했어요. 다시 시도해 주세요.</p>}
        {alert.status !== "installing" && (
          <div className="actions">
            {!alert.mandatory && (view.busy
              ? <button className="release-alert__secondary" onClick={() => IpcSender.releaseAlerts.cancel(() => {})}>취소</button>
              : <button className="release-alert__secondary" onClick={() => { setOpen(false); setRequestError(false); }}>나중에</button>)}
            <button
              autoFocus
              disabled={view.busy}
              onClick={() => {
                setRequestError(false);
                IpcSender.releaseAlerts.update(({ success }) => { if (!success) setRequestError(true); });
              }}
            >
              {view.busy ? "업데이트 중…" : view.action}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
