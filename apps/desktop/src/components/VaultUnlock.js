import { useEffect, useRef, useState } from "react";
import "./VaultUnlock.scss";
import PasswordField from "./PasswordField";

export default function VaultUnlock({ setup = false, osAvailable = false, passwordAvailable = true, preparationOnly = false, embedded = false,
  onOSUnlock, onPasswordUnlock, onCreate, onUnlocked }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupMethod,setSetupMethod]=useState(osAvailable?null:"password");
  const password = useRef(null), confirmation = useRef(null), mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async (method, event) => {
    event?.preventDefault();
    if (pending.current) return;
    const value = method === "os" ? "" : password.current?.value || "";
    if (setup && method === "password" && (Array.from(value).length < 12 || value !== confirmation.current?.value)) {
      setError("12자 이상 입력하고 두 비밀번호를 동일하게 맞춰주세요."); return;
    }
    if (!setup && method === "password" && !value) { setError("데이터 잠금 비밀번호를 입력해주세요."); return; }
    pending.current = true; setBusy(true); setError("");
    if (password.current) password.current.value = "";
    if (confirmation.current) confirmation.current.value = "";
    try {
      const action = setup ? onCreate : method === "os" ? onOSUnlock : onPasswordUnlock;
      if (typeof action !== "function") throw Error("UNAVAILABLE");
      if (await (setup && method === "os" ? action({method:"os"}) : method === "os" ? action() : action(value)) !== true) throw Error("UNVERIFIED_UNLOCK");
      if (mounted.current) onUnlocked?.();
    } catch {
      if (mounted.current) setError(setup ? "데이터 잠금을 설정하지 못했습니다. 다시 시도해주세요." :
        method === "os" ? "OS 인증이 취소되었어요. 비밀번호로도 열 수 있습니다." :
        "잠금을 해제하지 못했습니다. 비밀번호를 확인해주세요.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <section className="vault-unlock" aria-labelledby={embedded ? undefined : "vault-unlock-title"} aria-label={embedded ? "내 데이터 잠금 해제 방법" : undefined}>
    {!embedded && <><h2 id="vault-unlock-title">{setup ? "데이터 잠금 방법 선택" : "내 데이터 잠금 해제"}</h2>
      <p>{setup ? "이 기기에서 데이터를 열 때 사용할 방법을 고르세요. 복구 자료는 다음 단계에서 준비합니다." : "암호화된 데이터를 열려면 이 기기에서 본인 확인이 필요해요."}</p></>}
    {setup && osAvailable && <div className="vault-unlock-methods" role="group" aria-label="데이터 잠금 방법"><button type="button" aria-pressed={setupMethod==="os"} disabled={busy} onClick={()=>setSetupMethod("os")}>Windows Hello / Touch ID만</button><button type="button" aria-pressed={setupMethod==="password"} disabled={busy} onClick={()=>setSetupMethod("password")}>비밀번호도 사용</button></div>}
    {setup && setupMethod==="os" && <><p className="vault-unlock-note">이 기기의 OS 인증으로 엽니다. 기기를 잃어버릴 때를 대비해 다음 단계의 복구 자료는 꼭 보관하세요.</p><button type="button" className="vault-unlock-os" disabled={busy} onClick={()=>submit("os")}>{busy?"확인 중…":"OS 인증으로 설정"}</button></>}
    {!setup && osAvailable && <button type="button" className="vault-unlock-os" disabled={busy} onClick={() => submit("os")}>Windows Hello / Touch ID로 열기</button>}
    {!setup && osAvailable && passwordAvailable && <div className="vault-unlock-divider">또는</div>}
    {!setup && !osAvailable && !passwordAvailable && <p role="alert">이 기기에서 사용할 수 있는 잠금 해제 방법이 없어요. 복구가 필요합니다.</p>}
    {((setup && setupMethod==="password") || (!setup && passwordAvailable)) && <form onSubmit={event => submit("password", event)}>
      {setup && <p className="vault-unlock-note">로그인 비밀번호와는 별개예요. {osAvailable?"OS 인증이나 이 비밀번호로 열 수 있어요.":"잊지 않도록 안전하게 보관해주세요."}</p>}
      <label htmlFor="vault-password">데이터 잠금 비밀번호{setup ? " (12자 이상)" : ""}</label>
      <PasswordField ref={password} id="vault-password" label="데이터 잠금 비밀번호" maxLength={256} disabled={busy}
        autoComplete={setup ? "new-password" : "current-password"} required />
      {setup && <>
        <label htmlFor="vault-password-confirm">비밀번호 확인</label>
        <PasswordField ref={confirmation} id="vault-password-confirm" label="비밀번호 확인" maxLength={256} disabled={busy} autoComplete="new-password" required />
      </>}
      <button type="submit" disabled={busy}>{busy ? "확인 중…" : setup ? "비밀번호 설정" : "비밀번호로 열기"}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
