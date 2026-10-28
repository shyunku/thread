import { useEffect, useRef, useState } from "react";
import { IoCubeOutline, IoDesktopOutline, IoKeyOutline, IoListOutline, IoPersonOutline } from "react-icons/io5";
import IpcSender from "../../utils/IpcSender";
import { CheckCard, SettingsButton } from "./SettingsUI";
import StepDialog, { Callout } from "./data/StepDialog";
import { osAuthLabel } from "./data/format";
import { vaultAction, vaultCall } from "./data/vaultIpc";
import "./AccountDeleteDialog.scss";

const ACK = "모든 기기의 데이터가 지워지는 것을 이해했어요";
const FAILED = "계정을 삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.";

// What the reply code means for the person (null: say nothing, e.g. the OS prompt was cancelled).
export function deleteErrorText(code) {
  if (code === "OS_AUTH_CANCELLED") return null;
  if (code === "PASSWORD_REJECTED") return "보관함 비밀번호가 맞지 않아요.";
  if (code === "BUSY" || code === "OS_AUTH_BUSY") return "잠시 뒤에 다시 해 주세요.";
  if (/^OS_AUTH_/.test(code || "")) return `${osAuthLabel()}로 확인하지 못했어요.`;
  if (code === "ACCOUNT_DELETE_FORBIDDEN") return "이 계정은 앱에서 삭제할 수 없어요. 문의 메일로 요청해 주세요.";
  if (code === "UNAUTHORIZED" || code === "AUTH_REQUIRED") return "로그인이 만료됐어요. 다시 로그인한 뒤 삭제해 주세요.";
  return FAILED;
}

const callDelete = (input) => new Promise((resolve) => {
  IpcSender.vault.deleteAccount(input, ({ success, data } = {}) => resolve(success ? data : { deleted: false, code: data?.code || "VAULT_ACTION_FAILED" }));
});

// 계정 삭제 confirmation (#92, docs/designs/account-delete-mock.html frame ②): what goes,
// a backup hint, the "이해했어요" check, then the identity check that unlocks this PC
// (Windows Hello, or the vault password) right before the server deletes the account.
export default function AccountDeleteDialog({ account, onBackup, onDeleted, onClose }) {
  const [ack, setAck] = useState(false);
  const [methods, setMethods] = useState({ os: false, password: true });
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [devices, setDevices] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true);
  const chosen = useRef(false);
  useEffect(() => () => { live.current = false; }, []);

  // How this vault confirms the user, and how many devices are connected (both best effort).
  useEffect(() => {
    (async () => {
      const status = await vaultCall("status").catch(() => null);
      if (!live.current) return;
      const next = { os: !!status?.osAvailable, password: status ? !!status.passwordAvailable : true };
      setMethods(next);
      if (!chosen.current) setUsePassword(!next.os);
      const list = await vaultAction("rotation", "devices").catch(() => null);
      if (live.current && Array.isArray(list)) setDevices(list.length);
    })();
  }, []);

  const id = account?.authId || account?.googleEmail || account?.username || "이";
  const lose = [
    [IoPersonOutline, "계정", `${account?.authId ? `아이디 ${account.authId}` : "아이디"}, 사용자 이름, Google 연결`],
    [IoListOutline, "모든 기기의 할 일", "할 일·하위 할 일·카테고리·메모 전부 (서버의 암호화된 데이터 포함)"],
    [IoDesktopOutline, devices ? `연결된 기기 ${devices}대와 로그인` : "연결된 기기와 로그인", "다른 기기는 다음에 열 때 로그아웃돼요"],
    [IoKeyOutline, "복구 코드와 복구 파일", "더 이상 쓸 수 없어요"],
  ];

  const ready = ack && !busy && (!usePassword || password.length > 0);
  const run = async () => {
    if (!ready) return;
    const input = usePassword ? { method: "password", password } : { method: "os" };
    setPassword("");
    setBusy(true);
    setError("");
    const result = await callDelete(input);
    if (!live.current) return;
    if (result?.deleted) return onDeleted?.();
    setBusy(false);
    // A failed OS check falls back to the vault password when there is one.
    if (!usePassword && /^OS_AUTH_(FAILED|UNAVAILABLE|WINDOW_REQUIRED)$/.test(result?.code || "") && (result?.passwordAvailable ?? methods.password)) {
      chosen.current = true;
      setUsePassword(true);
      setError(`${osAuthLabel()}로 확인하지 못했어요. 보관함 비밀번호를 입력해 주세요.`);
      return;
    }
    const text = deleteErrorText(result?.code);
    if (text) setError(text);
  };

  const toggle = () => {
    chosen.current = true;
    setPassword("");
    setError("");
    setUsePassword((value) => !value);
  };

  const footer = (
    <>
      <SettingsButton disabled={busy} onClick={onClose}>취소</SettingsButton>
      <div className="auth-action">
        {usePassword && (
          <input className="step-dialog__input auth-action__password" type="password" aria-label="보관함 비밀번호"
            placeholder="보관함 비밀번호" autoComplete="off" maxLength={1024} disabled={busy} value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void run(); }} />
        )}
        {methods.os && methods.password && (
          <SettingsButton variant="ghost" className="auth-action__switch" disabled={busy} onClick={toggle}>
            {usePassword ? `${osAuthLabel()} 사용` : "비밀번호 사용"}
          </SettingsButton>
        )}
        <SettingsButton variant="kill" disabled={!ready} onClick={run}>
          {busy ? "삭제하는 중…" : usePassword ? "비밀번호로 계정 삭제" : `${osAuthLabel()}로 계정 삭제`}
        </SettingsButton>
      </div>
    </>
  );

  return (
    <StepDialog title="계정을 삭제할까요?" className="account-delete" footer={footer} closable={!busy} onClose={onClose}>
      <p><b>{id}</b> 계정을 삭제하면 아래 내용이 모든 기기에서 바로 지워져요. <b>되돌릴 수 없고</b>, 운영자도 되살릴 수 없어요.</p>
      <ul className="account-delete__lose" aria-label="지워지는 것">
        {lose.map(([Icon, title, detail]) => (
          <li key={title}>
            <Icon aria-hidden="true" />
            <div><b>{title}</b><span>{detail}</span></div>
          </li>
        ))}
      </ul>
      <Callout tone="info">
        <span className="account-delete__grow">할 일을 남겨 두려면 먼저 백업 파일로 내보내세요.</span>
        <SettingsButton disabled={busy} onClick={onBackup}><IoCubeOutline aria-hidden="true" />데이터 백업</SettingsButton>
      </Callout>
      <CheckCard checked={ack} disabled={busy} onChange={setAck}>{ACK}</CheckCard>
      {error && <div className="settings-error" role="alert">{error}</div>}
    </StepDialog>
  );
}
