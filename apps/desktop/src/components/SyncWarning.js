const SyncWarning = ({ status }) => {
  if (!status || (!status.error && !status.recovery?.length)) return null;

  return (
    <div role="status" style={{ padding: "8px 16px", background: "#282b32", color: "#eee" }}>
      {status.error ? "동기화를 보류했습니다." : "복구 검토가 필요합니다."}
      {status.error && ` · ${status.error}`}
      {status.detail && ` · ${status.detail}`}
      {status.recovery?.length > 0 && ` · 복구 검토 ${status.recovery.length}개`}
    </div>
  );
};

export default SyncWarning;
