import { useEffect, useRef, useState } from "react";
import IpcSender from "utils/IpcSender";
import "./ReleaseAlert.scss";

export default function ReleaseAlert() {
  const [alert, setAlert] = useState(null);
  const dismissed = useRef(new Set());
  const dialog = useRef(null);
  useEffect(() => {
    if (!alert) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, [alert?.version, alert?.mandatory]);
  useEffect(() => {
    let active = true;
    const receive = ({ success, data }) => {
      if (active && success) setAlert(data);
    };
    const listener = IpcSender.onAll("release-alert/available", receive);
    IpcSender.releaseAlerts.get(receive);
    return () => {
      active = false;
      IpcSender.off("release-alert/available", listener);
    };
  }, []);
  if (!alert || (!alert.mandatory && dismissed.current.has(alert.version)))
    return null;
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
        <h2 id="release-alert-title">
          {alert.mandatory ? "필수 업데이트" : "새 버전이 있습니다"}
        </h2>
        <p>Thread {alert.version}</p>
        {alert.mandatory && (
          <p>
            이전 버전과 호환되지 않는 업데이트입니다. 설치 파일을 자동으로
            다운로드합니다.
          </p>
        )}
        {alert.status === "downloading" && (
          <p role="status">설치 파일을 다운로드하고 있습니다…</p>
        )}
        {alert.status === "failed" && (
          <p role="status">
            다운로드하지 못했습니다. 연결을 확인하고 다시 시도해주세요.
          </p>
        )}
        {alert.status === "ready" && (
          <p role="status">
            다운로드 완료. 작업을 저장한 뒤 설치 파일을 실행해주세요.
          </p>
        )}
        <div className="actions">
          {!alert.mandatory && (
            <button
              onClick={() => {
                dismissed.current.add(alert.version);
                setAlert(null);
              }}
            >
              나중에
            </button>
          )}
          {alert.status === "ready" ? (
            <button
              autoFocus
              onClick={() => IpcSender.releaseAlerts.showFile()}
            >
              설치 파일 위치 열기
            </button>
          ) : (
            <button
              autoFocus
              disabled={alert.status === "downloading"}
              onClick={() => IpcSender.releaseAlerts.download()}
            >
              {alert.status === "failed" ? "다시 다운로드" : "다운로드"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
