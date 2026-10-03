import { useRef, useState } from "react";
import PasswordField from "../PasswordField";
import { osAuthLabel } from "../../modals/settings/data/format";
import { vaultCall } from "../../modals/settings/data/vaultIpc";
import { GateButton, GateCallout, GateStep, OptionCard } from "./GateFlow";

// Creates this device's local vault: OS authentication, optionally with a password.
export default function LockMethodStep({ kicker, step, total, osAvailable, onBack, onCreated }) {
  const [method, setMethod] = useState(osAvailable ? "os" : "password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const password = useRef(null);
  const confirmation = useRef(null);
  const os = osAuthLabel();

  const submit = async () => {
    const value = password.current?.value || "";
    if (method !== "os" && (Array.from(value).length < 12 || value !== confirmation.current?.value)) {
      setError("비밀번호는 12자 이상이고, 두 칸이 같아야 해요.");
      return;
    }
    setBusy(true);
    setError("");
    if (password.current) password.current.value = "";
    if (confirmation.current) confirmation.current.value = "";
    try {
      await vaultCall("create", method === "os" ? { method: "os" } : value);
      onCreated();
    } catch {
      setError(method === "os" ? `${os} 확인이 취소됐거나 실패했어요. 다시 시도해 주세요.` : "잠금을 설정하지 못했어요. 다시 시도해 주세요.");
      setBusy(false);
    }
  };

  return (
    <GateStep kicker={kicker} title="이 기기의 잠금 방법" step={step} total={total} label="잠금 방법"
      footer={<>
        <GateButton variant="ghost" disabled={busy} onClick={onBack}>이전</GateButton>
        <GateButton variant="primary" disabled={busy} onClick={submit}>
          {busy ? "설정 중…" : method === "os" ? `${os}로 설정` : "설정"}
        </GateButton>
      </>}>
      <p>앱을 열 때 이 방법으로 본인을 확인해요.</p>
      {osAvailable ? (
        <div role="radiogroup" aria-label="잠금 방법">
          <OptionCard selected={method === "os"} disabled={busy} onSelect={() => setMethod("os")}
            title={os} description="얼굴·지문·PIN으로 열어요." />
          <OptionCard selected={method === "both"} disabled={busy} onSelect={() => setMethod("both")}
            title={`${os} + 비밀번호`} description={`${os}를 쓸 수 없을 때 비밀번호로도 열 수 있어요.`} />
        </div>
      ) : (
        <GateCallout tone="info">이 기기에서는 {os}를 쓸 수 없어서 비밀번호로 잠가요.</GateCallout>
      )}
      {method !== "os" && (
        <>
          <label className="gate-field"><span>비밀번호 (12자 이상)</span>
            <PasswordField ref={password} id="gate-lock-password" label="비밀번호" maxLength={256} autoComplete="new-password" disabled={busy} />
          </label>
          <label className="gate-field"><span>비밀번호 확인</span>
            <PasswordField ref={confirmation} id="gate-lock-confirm" label="비밀번호 확인" maxLength={256} autoComplete="new-password" disabled={busy} />
          </label>
        </>
      )}
      <GateCallout tone="info">이 잠금은 이 기기에만 적용돼요. 로그인 비밀번호와는 별개예요.</GateCallout>
      {error && <GateCallout tone="danger">{error}</GateCallout>}
    </GateStep>
  );
}
