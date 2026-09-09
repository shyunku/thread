import "./Data.settings.scss";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { accountInfoSlice } from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";

const SettingData = () => {
  const { uid } = useSelector(accountInfoSlice);
  const [status, setStatus] = useState(null);
  const [requestError, setRequestError] = useState(false);

  useEffect(() => {
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
  }, [uid]);

  const current = status?.uid === uid ? status : null;
  const retry = () => {
    setRequestError(false);
    // The normal v2 loop publishes fresh status; never initialize/delete data.
    IpcSender.syncV2.retry(({ success }) => {
      if (!success) setRequestError(true);
    });
  };

  return (
    <div className="settings">
      <div className="setting-item">
        <div className="head"><div className="label">데이터 보호</div></div>
        <div className="body">
          <p>현재 동기화 방식은 Sync v2이며, 종단간 암호화(E2EE)는 아직 적용되지 않았습니다.</p>
          <p>서버 운영자는 저장된 할 일 내용을 조회할 수 있습니다. 기기 잠금이나 HTTPS 연결만으로 서버에서 내용을 읽지 못하게 되는 것은 아닙니다.</p>
          <p>E2EE 전환 후에도 이전 평문 백업과 로그의 정리 여부는 별도로 확인해야 합니다.</p>
        </div>
      </div>
      <div className="setting-item sync-status">
        <div className="head"><div className="label">동기화 상태</div></div>
        <div className="body">
          <div className="sync-summary" role="status">
            <div>{!current ? "동기화 상태 확인 중" : current.error ? "동기화 보류" : current.syncing ? "동기화 중" : current.connected ? "온라인" : "오프라인"}</div>
            <div>미전송 변경: {current?.pending ?? "—"}개</div>
            <div>마지막 반영 번호: {current?.seq ?? "—"}</div>
            {current?.error && <div>{current.error}</div>}
            {current?.recovery?.length > 0 && <div>복구 검토: {current.recovery.length}개</div>}
          </div>
          {requestError && <div role="alert">동기화 상태를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.</div>}
          <div className="controller">
            <div className="description">
              반영 번호는 태스크 개수가 아닌 서버 변경 순서입니다. 재동기화는 기존 데이터와 미전송 변경을 삭제하지 않습니다.
            </div>
            <button disabled={!current?.canSync || current?.syncing} onClick={retry}>다시 동기화</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingData;
