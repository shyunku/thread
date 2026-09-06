const SyncWarning = ({ status }) => {
  if (!status || (!status.error && !status.recovery?.length)) return null;

  return (
    <div role="status" style={{ padding: "8px 16px", background: "#282b32", color: "#eee" }}>
      {status.error === "LEGACY_REVIEW_REQUIRED"
        ? "기존 로컬 데이터·미전송 변경을 백업했습니다. 이관 검토 전까지 편집과 전송을 보류합니다."
        : status.error ? "동기화를 보류했습니다." : "복구 검토가 필요합니다."}
      {status.error && status.error !== "LEGACY_REVIEW_REQUIRED" && ` · ${status.error}`}
      {status.detail && ` · ${status.detail}`}
      {status.recovery?.length > 0 && ` · 복구 검토 ${status.recovery.length}개`}
    </div>
  );
};

export default SyncWarning;
