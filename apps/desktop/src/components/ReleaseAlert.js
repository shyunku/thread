import { useEffect, useRef, useState } from "react";
import { VscArrowDown, VscCheck, VscWarning } from "react-icons/vsc";
import IpcSender from "utils/IpcSender";
import "./ReleaseAlert.scss";

export default function ReleaseAlert() {
  const [alert, setAlert] = useState(null);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, [open, alert?.version]);
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
    IpcSender.releaseAlerts.get(receive);
    const show = () => setOpen(true);
    window.addEventListener("thread:open-update", show);
    return () => {
      active = false;
      IpcSender.off("release-alert/available", listener);
      window.removeEventListener("thread:open-update", show);
    };
  }, []);
  if (!alert || !open) return null;
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
          <span className="release-alert__symbol" aria-hidden="true">{alert.status === "ready" ? <VscCheck /> : alert.status === "failed" ? <VscWarning /> : <VscArrowDown />}</span>
          <div><span className="release-alert__eyebrow">THREAD UPDATE</span><h2 id="release-alert-title">{alert.mandatory ? "필수 업데이트" : "새 버전이 있습니다"}</h2></div>
        </div>
        <div className="release-alert__version">Thread <strong>{alert.version}</strong></div>
        {alert.mandatory && <p className="release-alert__notice">이 버전은 이전 버전과 호환되지 않습니다. 업데이트 후 계속 사용할 수 있어요.</p>}
        <div className="release-alert__status" role="status">
          <span className={`release-alert__status-dot release-alert__status-dot--${alert.status}`} aria-hidden="true" />
          <div>
            <strong>{alert.status === "ready" ? "다운로드 완료" : alert.status === "downloading" ? "다운로드 중" : alert.status === "failed" ? "다운로드 실패" : "다운로드 준비됨"}</strong>
            <p>{alert.status === "ready" ? "작업을 저장한 뒤 설치 후 재시작을 눌러주세요." : alert.status === "downloading" ? "설치 파일을 안전하게 확인하며 받고 있어요." : alert.status === "failed" ? "연결을 확인한 뒤 다시 시도해주세요." : "설치 파일은 다운로드 버튼을 누르면 받기 시작합니다."}</p>
          </div>
        </div>
        {installError && <p className="release-alert__error" role="alert">설치를 시작하지 못했어요. 앱을 닫지 말고 다시 시도해주세요.</p>}
        <div className="actions">
          {!alert.mandatory && (
            <button className="release-alert__secondary" onClick={() => setOpen(false)}>
              나중에
            </button>
          )}
          {alert.status === "ready" ? (
            <button
              autoFocus
              disabled={installing}
              onClick={() => {
                setInstalling(true);setInstallError(false);
                IpcSender.releaseAlerts.install(({success})=>{setInstalling(false);if(!success)setInstallError(true);});
              }}
            >
              {installing ? "설치 시작 중…" : "설치 후 재시작"}
            </button>
          ) : (
            <button
              autoFocus
              disabled={alert.status === "downloading"}
              onClick={() => IpcSender.releaseAlerts.download()}
            >
              {alert.status === "downloading" ? "다운로드 중…" : alert.status === "failed" ? "다시 다운로드" : "다운로드"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
