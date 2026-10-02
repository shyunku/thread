import { useEffect, useState } from "react";
import { VscRefresh } from "react-icons/vsc";
import IpcSender from "../../../utils/IpcSender";
import { Badge, SettingsCard } from "../SettingsUI";
import { relativeTime } from "./format";

const PREVIEW_STATUS = { protocolVersion: 3, connected: true, pending: 2, seq: "128", canSync: true, recovery: 0 };

export default function SyncStatus({ uid, preview = false }) {
  const [status, setStatus] = useState(preview ? { uid, ...PREVIEW_STATUS, lastSyncedAt: Date.now() - 5 * 60000 } : null);
  const [requestError, setRequestError] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (preview) return;
    let active = true;
    let receivedEvent = false;
    setStatus(null);
    setRequestError(false);
    const onStatus = ({ success, data }) => {
      if (active && success && data?.uid === uid) {
        receivedEvent = true;
        setStatus(data);
        setRequestError(false);
      }
    };
    const listener = IpcSender.onAll("sync-v2/status", onStatus);
    IpcSender.syncV2.getStatus((response) => {
      if (!active || receivedEvent) return;
      if (response.success) onStatus(response);
      else setRequestError(true);
    });
    return () => {
      active = false;
      IpcSender.off("sync-v2/status", listener);
    };
  }, [uid, preview]);

  // Re-render every minute so "n분 전" stays current; the value is computed at render time.
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const current = status?.uid === uid ? status : null;
  const recoveryCount = typeof current?.recovery === "number" ? current.recovery : current?.recovery?.length;
  const label = !current ? "확인 중" : current.error ? "동기화 보류" : current.syncing ? "동기화 중" : current.connected ? "온라인" : "오프라인";
  const pending = Math.max(0, Number(current?.pending) || 0);
  const known = current && current.pending !== null && current.pending !== undefined;
  const canRetry = !preview && !!current?.connected && !!current?.canSync && !current?.syncing;
  const synced = relativeTime(current?.lastSyncedAt);
  const retry = () => {
    setRequestError(false);
    // The normal sync loop publishes fresh status; never initialize/delete data.
    IpcSender.syncV2.retry(({ success }) => {
      if (!success) setRequestError(true);
    });
  };

  return (
    <SettingsCard className="sync-status">
      <div className="sync-status__row" role="status">
        <Badge tone={current?.connected && !current?.error ? "success" : "neutral"}>{label}</Badge>
        <div className={"sync-status__bar" + (!current?.connected ? " sync-status__bar--offline" : "")}
          role="img" aria-label={`보낼 변경 ${known ? pending : "확인 중"}개`}>
          {pending > 0 ? <><i className="sync-status__done" style={{ flex: 82 }} /><i className="sync-status__pending" style={{ flex: 18 }} /></>
            : <i className="sync-status__idle" style={{ flex: 1 }} />}
        </div>
        <span className={"sync-status__meta" + (pending > 0 ? "" : " sync-status__meta--quiet")}>
          {pending > 0 ? <span className="sync-status__pending-text">보낼 변경 {pending}개</span> : `보낼 변경 ${known ? 0 : "—"}개`}
          {synced && ` · ${synced} 동기화`}
        </span>
        <button type="button" className="sync-status__refresh" aria-label="지금 동기화" title="지금 동기화"
          disabled={!canRetry} onClick={retry}><VscRefresh aria-hidden="true" /></button>
      </div>
      {current?.error && <div className="sync-status__message">{current.error === "VAULT_LOCKED" ? "앱이 잠겨 있어 동기화를 멈췄어요." : current.error}</div>}
      {recoveryCount > 0 && <div className="sync-status__message">충돌 검토가 필요한 변경: {recoveryCount}개</div>}
      {requestError && <div className="sync-status__message" role="alert">동기화 상태를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.</div>}
    </SettingsCard>
  );
}
