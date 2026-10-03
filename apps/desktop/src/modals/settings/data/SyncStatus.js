import { useEffect, useRef, useState } from "react";
import { VscRefresh } from "react-icons/vsc";
import IpcSender from "../../../utils/IpcSender";
import { Badge, SettingsCard } from "../SettingsUI";
import { relativeTime } from "./format";

const PREVIEW_STATUS = { protocolVersion: 3, connected: true, pending: 2, seq: "128", canSync: true, recovery: 0 };
// Most syncs finish in a few hundred ms; keep the flowing bar long enough to read as one calm pulse.
export const SYNCING_MIN_MS = 900;

function useSyncingDisplay(syncing) {
  const [shown, setShown] = useState(syncing);
  const startedAt = useRef(0);
  useEffect(() => {
    if (syncing) {
      startedAt.current = Date.now();
      setShown(true);
      return undefined;
    }
    const left = SYNCING_MIN_MS - (Date.now() - startedAt.current);
    if (left <= 0) {
      setShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setShown(false), left);
    return () => clearTimeout(timer);
  }, [syncing]);
  return shown;
}

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
  const syncing = useSyncingDisplay(!!current?.connected && !current?.error && !!current?.syncing);
  const recoveryCount = typeof current?.recovery === "number" ? current.recovery : current?.recovery?.length;
  const label = !current ? "확인 중" : current.error ? "동기화 보류" : syncing ? "동기화 중" : current.connected ? "온라인" : "오프라인";
  const pending = Math.max(0, Number(current?.pending) || 0);
  const known = current && current.pending !== null && current.pending !== undefined;
  // Everything sent and nothing waiting: show a full green bar instead of an empty one.
  const allSynced = known && pending === 0 && !!current?.connected && !current?.error && !!current?.lastSyncedAt;
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
        {/* The same two segments stay mounted in every state so width and color changes animate. */}
        <div className={"sync-status__bar" + (!current?.connected ? " sync-status__bar--offline" : "") +
          (syncing ? " sync-status__bar--syncing" : "")}
          role="img" aria-label={allSynced ? "모두 동기화됨" : `보낼 변경 ${known ? pending : "확인 중"}개`}>
          <i className={"sync-status__done" + (pending > 0 || allSynced ? "" : " sync-status__done--idle")}
            style={{ flexGrow: pending > 0 ? 82 : 1 }} />
          <i className={"sync-status__pending" + (pending > 0 ? "" : " sync-status__pending--empty")}
            style={{ flexGrow: pending > 0 ? 18 : 0 }} />
        </div>
        <span className={"sync-status__meta" + (pending > 0 || allSynced ? "" : " sync-status__meta--quiet")}>
          {pending > 0 ? <><span className="sync-status__pending-text">보낼 변경 {pending}개</span>{synced && ` · ${synced} 동기화`}</>
            : allSynced ? <><span className="sync-status__ok-text">모두 동기화됨</span>{` · ${synced}`}</>
              : <>{`보낼 변경 ${known ? 0 : "—"}개`}{synced && ` · ${synced} 동기화`}</>}
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
