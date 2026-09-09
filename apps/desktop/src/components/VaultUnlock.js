import { useEffect, useRef, useState } from "react";
import "./VaultUnlock.scss";

export default function VaultUnlock({ setup = false, osAvailable = false, passwordAvailable = true, preparationOnly = false,
  onOSUnlock, onPasswordUnlock, onCreate, onUnlocked }) {
  const [method, setMethod] = useState(osAvailable ? "os" : "password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const password = useRef(null), confirmation = useRef(null), mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!osAvailable && method === "os") setMethod("password"); }, [osAvailable, method]);
  const select = value => {
    if (password.current) password.current.value = "";
    setError(""); setMethod(value);
  };
  const submit = async event => {
    event.preventDefault();
    if (pending.current) return;
    const value = password.current?.value || "";
    if (setup && (Array.from(value).length < 12 || value !== confirmation.current?.value)) {
      setError("12자 이상 입력하고 두 비밀번호를 동일하게 맞춰주세요."); return;
    }
    if (!setup && method === "password" && !value) { setError("보관함 비밀번호를 입력해주세요."); return; }
    pending.current = true; setBusy(true); setError("");
    if (password.current) password.current.value = "";
    if (confirmation.current) confirmation.current.value = "";
    try {
      const action = setup ? onCreate : method === "os" ? onOSUnlock : onPasswordUnlock;
      if (typeof action !== "function") throw Error("UNAVAILABLE");
      if (await action(value) !== true) throw Error("UNVERIFIED_UNLOCK");
      if (mounted.current) onUnlocked?.();
    } catch {
      if (mounted.current) setError(setup ? "보관함 비밀번호를 설정하지 못했습니다. 다시 시도해주세요." :
        method === "os" ? "OS 인증이 취소되었거나 사용할 수 없습니다. 비밀번호 방식도 선택할 수 있어요." :
        "잠금을 해제하지 못했습니다. 비밀번호를 확인해주세요.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <section className="vault-unlock" aria-labelledby="vault-unlock-title">
    <h2 id="vault-unlock-title">{setup ? "보관함 비밀번호 만들기" : "보관함 잠금 해제"}</h2>
    <p>{preparationOnly?"로그인 비밀번호와 별개로, 준비 중인 로컬 보관함을 여는 비밀번호예요. 기존 할 일은 아직 옮기지 않습니다.":"로그인 비밀번호와 별개로, 이 기기의 암호화된 할 일 데이터를 여는 비밀번호예요."}</p>
    <p className="vault-unlock-note">{preparationOnly?"이 단계에서는 계정 복구 키를 생성하지 않습니다. 비밀번호와 OS 인증을 모두 사용할 수 없으면 임의로 초기화하지 마세요.":"복구 키와도 달라요. 비밀번호를 잊었을 때를 위해 복구 키는 따로 안전하게 보관해주세요."}</p>
    {!setup && <div className="vault-unlock-methods" role="group" aria-label="잠금 해제 방법">
      <button type="button" disabled={busy || !osAvailable} aria-pressed={method === "os"} onClick={() => select("os")}>Windows Hello / Touch ID</button>
      <button type="button" disabled={busy || !passwordAvailable} aria-pressed={method === "password"} onClick={() => select("password")}>보관함 비밀번호</button>
    </div>}
    {!setup && !osAvailable && <p>이 기기에서는 OS 인증을 사용할 수 없어요.</p>}
    <form onSubmit={submit}>
      {(setup || (method === "password" && passwordAvailable)) && <>
        <label htmlFor="vault-password">보관함 비밀번호{setup ? " (12자 이상)" : ""}</label>
        <input ref={password} id="vault-password" type="password" maxLength={256} disabled={busy}
          autoComplete={setup ? "new-password" : "current-password"} required />
      </>}
      {setup && <>
        <label htmlFor="vault-password-confirm">비밀번호 확인</label>
        <input ref={confirmation} id="vault-password-confirm" type="password" maxLength={256} disabled={busy} autoComplete="new-password" required />
      </>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy || (!setup && (method === "os" ? !osAvailable : !passwordAvailable))}>
        {busy ? "확인 중…" : setup ? "비밀번호 설정" : method === "os" ? "OS 인증으로 잠금 해제" : "비밀번호로 잠금 해제"}
      </button>
    </form>
  </section>;
}
