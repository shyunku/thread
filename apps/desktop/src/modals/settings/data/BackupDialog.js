import { useEffect, useRef, useState } from "react";
import { Segmented, SettingsButton, SettingsCard, SettingsRow } from "../SettingsUI";
import StepDialog, { AuthAction, Callout, Code } from "./StepDialog";
import { vaultAction } from "./vaultIpc";

const FAILED = "처리하지 못했어요. 백업 코드와 파일, 본인 확인을 확인해 주세요. 같은 이름의 파일이 있으면 덮어쓰지 않아요.";

// Export: a fresh backup code + encrypted file. Import: stage a file as a separate copy,
// review titles, then add its items as new items (existing data is never overwritten).
export default function BackupDialog({ osAvailable = false, onClose, onChanged }) {
  const [tab, setTab] = useState("export");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Export
  const [code, setCode] = useState("");
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(null);
  // Import
  const [copies, setCopies] = useState([]);
  const [staged, setStaged] = useState(null);
  const [page, setPage] = useState(null);
  const [consent, setConsent] = useState(false);
  const [applied, setApplied] = useState(null);
  const importCode = useRef(null);
  const live = useRef(true);
  const pending = useRef(false);

  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    vaultAction("backup", "code").then((value) => { if (live.current) setCode(value); }).catch(() => {});
    vaultAction("backup", "list").then((list) => { if (live.current) setCopies(list || []); }).catch(() => {});
  }, []);

  const run = async (task) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try { await task(); }
    catch { if (live.current) setError(FAILED); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };

  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); } };
  const save = (auth) => run(async () => {
    const result = await vaultAction("backup", "export", { code, confirmed: true, ...auth });
    if (!result || !live.current) return; // save dialog cancelled
    setExported(result);
    onChanged?.();
  });
  const review = (id, after) => run(async () => {
    const value = await vaultAction("backup", "review", { id, after });
    if (!live.current) return;
    setStaged((old) => (old?.id === id ? old : { id, count: value.count }));
    setPage(value);
  });
  const restore = (auth) => run(async () => {
    const value = importCode.current?.value || "";
    if (importCode.current) importCode.current.value = "";
    const result = await vaultAction("backup", "restore", { code: value, confirmed: true, ...auth });
    if (!result || !live.current) return; // open dialog cancelled
    setStaged({ id: result.id, count: result.count });
    const first = await vaultAction("backup", "review", { id: result.id });
    if (live.current) setPage(first);
  });
  const apply = (auth) => run(async () => {
    const result = await vaultAction("backup", "apply", { id: staged.id, confirmed: true, ...auth });
    if (!live.current) return;
    setApplied(result);
    onChanged?.();
  });

  const finished = tab === "export" ? exported : applied;
  const footer = finished ? (
    <><span /><SettingsButton variant="primary" onClick={onClose}>닫기</SettingsButton></>
  ) : tab === "export" ? (
    <>
      <SettingsButton variant="ghost" disabled={busy} onClick={onClose}>취소</SettingsButton>
      <AuthAction osAvailable={osAvailable} verb="저장" busy={busy} disabled={!code || !kept} onRun={save} />
    </>
  ) : staged && page ? (
    <>
      <SettingsButton variant="ghost" disabled={busy} onClick={() => { setStaged(null); setPage(null); setConsent(false); }}>이전</SettingsButton>
      <AuthAction osAvailable={osAvailable} verb={`${staged.count}개 추가`} busy={busy} disabled={!consent} onRun={apply} />
    </>
  ) : (
    <>
      <SettingsButton variant="ghost" disabled={busy} onClick={onClose}>취소</SettingsButton>
      <AuthAction osAvailable={osAvailable} verb="파일 열기" busy={busy} onRun={restore} />
    </>
  );

  return (
    <StepDialog title="데이터 백업" onClose={onClose} closable={!busy} footer={footer}>
      {!finished && (
        <div className="backup-dialog__tabs">
          <Segmented label="백업 작업" value={tab} disabled={busy} onChange={(value) => { setError(""); setTab(value); }}
            options={[{ value: "export", label: "내보내기" }, { value: "import", label: "불러오기" }]} />
        </div>
      )}
      {tab === "export" && (exported ? (
        <>
          <p className="ok">✓ {exported.count}개 항목을 백업했어요.</p>
          <p>백업 파일을 열 때 이 백업 코드가 필요해요. 파일과 다른 곳에 보관하세요.</p>
          <Code size="small">{code}</Code>
        </>
      ) : (
        <>
          <p>할 일 전체를 암호화된 파일로 저장합니다. 파일을 열 때 필요한 <b>백업 코드</b>도 함께 보관하세요.</p>
          <Code size="small">{code || "코드를 만드는 중…"}</Code>
          <div className="step-dialog__list"><SettingsButton disabled={!code} onClick={copy}>{copied ? "복사했어요" : "코드 복사"}</SettingsButton></div>
          <label className="step-dialog__check">
            <input type="checkbox" checked={kept} disabled={busy || !code} onChange={(event) => setKept(event.target.checked)} />
            백업 코드를 따로 보관했어요.
          </label>
        </>
      ))}
      {tab === "import" && (applied ? (
        <p className="ok">✓ {applied.count}개 항목을 새 항목으로 추가했어요. 동기화되면 다른 기기에도 나타나요.</p>
      ) : staged && page ? (
        <>
          <p>백업 파일의 항목을 <b>새 항목으로 추가</b>합니다. 지금 있는 데이터는 바뀌지 않아요.</p>
          <SettingsCard>
            {page.items.filter((item) => !item.deleted).slice(0, 6).map((item) => (
              <SettingsRow key={item.id} label={item.content.title || "(제목 없음)"} description={item.content.memo ? item.content.memo.slice(0, 80) : undefined} />
            ))}
            {staged.count > 6 && <SettingsRow description={`외 ${staged.count - 6}개`} />}
          </SettingsCard>
          {page.next && <div className="step-dialog__list"><SettingsButton disabled={busy} onClick={() => review(staged.id, page.next)}>다음 항목 보기</SettingsButton></div>}
          <Callout>같은 할 일이 이미 있으면 중복될 수 있어요.</Callout>
          <label className="step-dialog__check">
            <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
            백업의 항목을 새 항목으로 추가할게요.
          </label>
        </>
      ) : (
        <>
          <p>백업 파일을 열어 내용을 먼저 확인합니다. 지금 있는 데이터는 바뀌지 않아요.</p>
          <input ref={importCode} className="step-dialog__input" type="password" aria-label="백업 코드" placeholder="백업 코드"
            autoComplete="off" maxLength={128} disabled={busy} />
          {copies.length > 0 && (
            <div className="step-dialog__list">
              <p>이전에 열어 둔 백업</p>
              <SettingsCard>
                {copies.map((item, index) => (
                  <SettingsRow key={item.id} label={`백업 ${index + 1}`} description={item.phase === "STAGED" ? "확인을 마치지 않았어요" : "추가 대기"}>
                    <SettingsButton disabled={busy} onClick={() => review(item.id)}>검토</SettingsButton>
                  </SettingsRow>
                ))}
              </SettingsCard>
            </div>
          )}
        </>
      ))}
      {error && <Callout tone="danger">{error}</Callout>}
    </StepDialog>
  );
}
