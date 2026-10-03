import { useEffect, useRef, useState } from "react";
import PasswordField from "../PasswordField";
import { osAuthLabel } from "../../modals/settings/data/format";
import { vaultCall } from "../../modals/settings/data/vaultIpc";
import { CheckRow, GateButton, GateCallout, GateStep } from "./GateFlow";
import LockMethodStep from "./LockMethodStep";

const KICKER = "복구 코드로 연결";
const TOTAL = 5;
const recovery = (action, input = {}) => vaultCall("lostRecovery", action, input);
const PREPARED = ["RECOVERY_UNCONFIRMED", "RECOVERY_CONFIRMED", "COMMITTING"];

// Re-authentication for recovery steps: OS authentication when available, otherwise the device password.
function useAuth(osAvailable) {
  const password = useRef(null);
  const field = osAvailable ? null : (
    <label className="gate-field"><span>이 기기 잠금 비밀번호</span>
      <PasswordField ref={password} id="gate-recovery-password" label="잠금 비밀번호" maxLength={1024} autoComplete="off" />
    </label>
  );
  const take = () => {
    if (osAvailable) return { method: "os" };
    const value = password.current?.value || "";
    if (password.current) password.current.value = "";
    return { method: "password", password: value };
  };
  return { field, take, verb: (action) => (osAvailable ? `${osAuthLabel()}로 ${action}` : action) };
}

// All existing devices are lost: the old recovery file and code approve this device,
// every other device is removed and new recovery material replaces the old one.
export default function RecoveryConnect({ status, onBack, onConnected, onLockCreated }) {
  const osAvailable = !!status?.osAvailable;
  const needsLock = status?.phase === "ABSENT";
  const [step, setStep] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState(null);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const oldCode = useRef(null);
  const newCode = useRef(null);
  const live = useRef(true);
  const auth = useAuth(osAvailable);

  // Resume a recovery that was prepared before the app was closed.
  useEffect(() => {
    live.current = true;
    if (needsLock) { setStep("warn"); return () => { live.current = false; }; }
    recovery("status").then((value) => {
      if (!live.current) return;
      setPhase(value?.phase ?? null);
      setStep(value?.phase === "ACTIVE" ? "done" : PREPARED.includes(value?.phase) ? (value.phase === "RECOVERY_UNCONFIRMED" ? "new" : "apply") : "warn");
    }).catch(() => { if (live.current) setStep("warn"); });
    return () => { live.current = false; };
  }, [needsLock]);
  useEffect(() => {
    if (!code) return undefined;
    const timer = setTimeout(() => setCode(""), 30000);
    return () => clearTimeout(timer);
  }, [code]);

  const run = async (task, failure) => {
    setBusy(true);
    setError("");
    try { await task(); }
    catch { if (live.current) setError(failure); }
    finally { if (live.current) setBusy(false); }
  };
  const prepare = () => run(async () => {
    const value = oldCode.current?.value || "";
    if (oldCode.current) oldCode.current.value = "";
    const next = await recovery("prepare", { confirmed: true, code: value, ...auth.take() });
    if (!live.current || !next) return; // file dialog cancelled
    setPhase(next.phase);
    setStep("new");
  }, "복구 파일과 코드를 확인하지 못했어요. 처음 설정할 때 저장한 최신 파일과 코드인지 확인해 주세요.");
  const reveal = () => run(async () => { const value = await recovery("code"); if (live.current) setCode(value); }, "새 복구 코드를 불러오지 못했어요.");
  const exportFile = () => run(async () => { if ((await recovery("export")) === true && live.current) setSaved(true); }, "새 복구 파일을 저장하지 못했어요. 다른 위치에 저장해 보세요.");
  const confirm = () => run(async () => {
    const value = newCode.current?.value || "";
    if (newCode.current) newCode.current.value = "";
    const next = await recovery("confirm", { code: value });
    if (!live.current || !next) return;
    setPhase(next.phase);
    if (next.phase === "RECOVERY_CONFIRMED") setStep("apply");
  }, "새 복구 코드나 파일이 맞지 않아요. 방금 저장한 파일과 코드인지 확인해 주세요.");
  const commit = () => run(async () => {
    const next = await recovery("commit", { confirmed: true, ...auth.take() });
    if (!live.current || !next) return;
    setPhase(next.phase);
    if (next.phase === "ACTIVE") setStep("done");
  }, "서버에서 결과를 확인하지 못했어요. 앱을 지우거나 초기화하지 말고 같은 화면에서 다시 시도하세요.");
  const abandon = () => run(async () => { await recovery("cancel"); if (live.current) onBack(); }, "복구를 취소하지 못했어요.");

  if (!step) return null;
  if (step === "warn") {
    return (
      <GateStep kicker={KICKER} title="쓰던 기기를 모두 잃었나요?" step={1} total={TOTAL} label="확인"
        footer={<><GateButton variant="ghost" onClick={onBack}>이전</GateButton>
          <GateButton variant="primary" disabled={!consent} onClick={() => setStep(needsLock ? "lock" : "input")}>다음</GateButton></>}>
        <p>복구 코드로 연결하면 이 기기가 새 기준이 돼요. 쓰던 기기가 하나라도 남아 있다면 <b>쓰던 기기로 연결</b>을 쓰세요.</p>
        <ul className="gate-list">
          <li>다른 모든 기기의 연결이 해제돼요. 그 기기들은 다시 연결해야 해요.</li>
          <li>복구 코드와 복구 파일이 새로 바뀌어요. 예전 것은 쓸 수 없어요.</li>
          <li>잃어버린 기기에서 서버로 보내지 못한 변경은 되살릴 수 없어요.</li>
        </ul>
        <CheckRow checked={consent} onChange={setConsent}>이해했고, 다른 기기의 연결을 모두 해제할게요.</CheckRow>
      </GateStep>
    );
  }
  if (step === "lock") {
    return <LockMethodStep kicker={KICKER} step={2} total={TOTAL} osAvailable={osAvailable}
      onBack={() => setStep("warn")} onCreated={() => { onLockCreated?.(); setStep("input"); }} />;
  }
  if (step === "input") {
    return (
      <GateStep kicker={KICKER} title="복구 자료 입력" step={3} total={TOTAL} label="복구 자료"
        footer={<><GateButton variant="ghost" disabled={busy} onClick={() => setStep("warn")}>이전</GateButton>
          <GateButton variant="primary" disabled={busy} onClick={prepare}>{busy ? "확인 중…" : auth.verb("복구 파일 열기")}</GateButton></>}>
        <p>처음 설정할 때 저장한 <b>복구 코드</b>를 입력한 뒤, <b>복구 파일</b>(.trec)을 열어요. 둘 다 있어야 해요.</p>
        <label className="gate-field"><span>복구 코드</span>
          <PasswordField ref={oldCode} id="gate-old-recovery-code" label="복구 코드" placeholder="THREAD1-…" maxLength={128} autoComplete="off" disabled={busy} />
        </label>
        {auth.field}
        {error && <GateCallout tone="danger">{error}</GateCallout>}
      </GateStep>
    );
  }
  if (step === "new") {
    return (
      <GateStep kicker={KICKER} title="새 복구 자료 보관" step={4} total={TOTAL} label="새 복구 자료"
        footer={<><GateButton variant="ghost" disabled={busy} onClick={abandon}>복구 취소</GateButton>
          <GateButton variant="primary" disabled={busy || !saved} onClick={confirm}>{busy ? "확인 중…" : "파일 열어 확인"}</GateButton></>}>
        <p>예전 복구 자료는 쓸 수 없게 돼요. 새 복구 파일과 코드를 <b>서로 다른 곳</b>에 보관하세요.</p>
        <GateButton className="gate-button--block" disabled={busy} onClick={exportFile}>{saved ? "새 복구 파일 다시 저장" : "새 복구 파일 저장"}</GateButton>
        {code ? (
          <><div className="gate-code">{code}</div><p className="gate-muted">30초 뒤 가려져요.</p></>
        ) : (
          <p style={{ marginTop: 12 }}><GateButton disabled={busy} onClick={reveal}>새 복구 코드 보기</GateButton></p>
        )}
        <label className="gate-field"><span>새 복구 코드를 입력해 확인</span>
          <PasswordField ref={newCode} id="gate-new-recovery-code" label="새 복구 코드" placeholder="THREAD1-…" maxLength={128} autoComplete="off" disabled={busy || !saved} />
          <small>입력한 뒤 방금 저장한 파일을 열어 둘이 맞는지 확인해요.</small>
        </label>
        {error && <GateCallout tone="danger">{error}</GateCallout>}
      </GateStep>
    );
  }
  if (step === "apply") {
    return (
      <GateStep kicker={KICKER} title="복구 적용" step={5} total={TOTAL} label="적용"
        footer={<><GateButton variant="ghost" disabled={busy || phase === "COMMITTING"} onClick={abandon}>복구 취소</GateButton>
          <GateButton variant="danger" disabled={busy} onClick={commit}>{busy ? "적용 중…" : phase === "COMMITTING" ? auth.verb("결과 다시 확인") : auth.verb("적용")}</GateButton></>}>
        <p>적용하면 다른 모든 기기의 연결이 해제되고, 이 기기로 데이터를 열 수 있게 돼요.</p>
        {auth.field}
        <GateCallout tone="warning">서버 응답을 받지 못하면 같은 화면에서 다시 시도하세요. 앱을 지우거나 초기화하지 마세요.</GateCallout>
        {error && <GateCallout tone="danger">{error}</GateCallout>}
      </GateStep>
    );
  }
  return (
    <GateStep kicker={KICKER} title="복구했어요" step={TOTAL} total={TOTAL} label="완료"
      footer={<><span /><GateButton variant="primary" onClick={onConnected}>시작하기</GateButton></>}>
      <p className="gate-ok">✓ 이 기기로 데이터를 열 수 있게 됐어요.</p>
      <p>다른 기기는 다시 연결해야 해요. 새 복구 파일과 코드를 잘 보관하세요.</p>
    </GateStep>
  );
}
