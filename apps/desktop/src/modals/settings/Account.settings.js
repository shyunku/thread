import PackageJson from "../../../package.json";
import IpcSender from "../../utils/IpcSender";
import Prompt from "../../molecules/Prompt";
import Toast from "../../molecules/Toast";
import { accountInfoSlice, removeAccount, removeAuth } from "../../store/accountSlice";
import { useDispatch, useSelector } from "react-redux";
import { useState } from "react";
import { vaultCall } from "./data/vaultIpc";
import { setLoginNotice } from "../../utils/loginNotice";
import AccountDeleteDialog from "./AccountDeleteDialog";
import { Badge, SettingsButton, SettingsCard, SettingsPage, SettingsRow, SettingsSection } from "./SettingsUI";

const maskEmail = (email) => {
  const [name, domain] = String(email || "").split("@");
  if (!domain) return email || "";
  return name.slice(0, Math.min(8, Math.max(1, name.length - 2))) + "••••@" + domain;
};
const platformLabel = () => (/Mac/i.test(navigator.platform) ? "macOS" : "Windows");

const SettingAccount = ({ modalRef, preview = false, previewPanel = null, openPage }) => {
  const stored = useSelector(accountInfoSlice);
  const account = preview ? { username: "Jo", authId: "shyunku", googleEmail: null } : stored;
  const dispatch = useDispatch();
  const [revoking, setRevoking] = useState(false);
  const [deleting, setDeleting] = useState(preview && previewPanel === "delete");

  // Deleted (#92): main already removed this PC's vault and account; the login screen says so.
  const deleted = () => {
    setDeleting(false);
    if (preview) return;
    setLoginNotice("deleted");
    dispatch(removeAuth());
    dispatch(removeAccount());
    modalRef?.current?.close();
  };
  const name = account?.username || account?.googleEmail || "사용자";
  const email = account?.googleEmail;
  // authId: string = password login, null = none, undefined = saved before this was recorded.
  const passwordLogin = typeof account?.authId === "string" ? { badge: "사용 중", desc: account.authId }
    : account?.authId === null ? { badge: null, desc: "사용하지 않아요" }
    : !email ? { badge: "사용 중", desc: "아이디로 로그인" } : { badge: null, desc: "다시 로그인하면 표시돼요" };

  const logout = () => {
    Prompt.float("로그아웃", "정말 로그아웃 하시겠습니까?", {
      confirmText: "로그아웃",
      cancelText: "취소",
      onConfirm: async () => {
        try {
          await IpcSender.req.auth.deleteAuthInfoSync(stored?.uid);
          dispatch(removeAuth());
          dispatch(removeAccount());
          Toast.info("로그아웃 되었습니다.");
          modalRef?.current?.close();
        } catch (err) {
          console.log(err);
          Toast.error("인증 정보 삭제에 실패했습니다. 다시 시도해주세요.");
        }
      },
      onCancel: () => {},
    });
  };

  const revokeOthers = () => {
    Prompt.float("다른 곳에서 모두 로그아웃", "이 기기를 제외한 모든 기기와 앱에서 로그아웃합니다. 다른 기기에서는 다시 로그인해야 해요.", {
      confirmText: "모두 로그아웃",
      cancelText: "취소",
      onConfirm: async () => {
        setRevoking(true);
        try {
          await vaultCall("revokeOtherSessions");
          Toast.info("다른 곳의 로그인을 모두 끊었어요.");
        } catch {
          Toast.error("로그아웃하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
        } finally {
          setRevoking(false);
        }
      },
      onCancel: () => {},
    });
  };

  return (
    <SettingsPage title="계정" description="로그인한 계정을 관리합니다.">
      <SettingsCard>
        <SettingsRow className="account-profile" icon={<span className="account-avatar">{name.slice(0, 1).toUpperCase()}</span>}
          label={name} description={email ? maskEmail(email) : undefined} />
      </SettingsCard>

      <SettingsSection title="로그인 방식">
        <SettingsCard>
          <SettingsRow label="아이디·비밀번호" description={passwordLogin.desc}>
            {passwordLogin.badge && <Badge tone="success">{passwordLogin.badge}</Badge>}
          </SettingsRow>
          <SettingsRow label="Google" description={email ? `연결됨 · ${maskEmail(email)}` : "연결하면 Google 계정으로도 로그인할 수 있어요."}>
            {email ? <Badge tone="success">연결됨</Badge>
              : <SettingsButton disabled title="서버 업데이트 후 사용할 수 있어요">Google 계정 연결</SettingsButton>}
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="세션">
        <SettingsCard>
          <SettingsRow label="이 기기" description={`${platformLabel()} · ${PackageJson.version}`} />
          <SettingsRow label="다른 곳에서 모두 로그아웃" description="이 기기를 제외한 모든 로그인을 끊습니다.">
            <SettingsButton disabled={preview || revoking} onClick={revokeOthers}>{revoking ? "로그아웃 중…" : "모두 로그아웃"}</SettingsButton>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection>
        <SettingsCard>
          <SettingsRow label="로그아웃" description="이 기기에서 로그아웃합니다.">
            <SettingsButton variant="danger" disabled={preview} onClick={logout}>로그아웃</SettingsButton>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection>
        <SettingsCard className="settings-card--danger">
          <SettingsRow label="계정 삭제" description="계정과 모든 기기의 할 일을 지워요. 되돌릴 수 없어요.">
            <SettingsButton variant="danger" onClick={() => setDeleting(true)}>계정 삭제…</SettingsButton>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      {deleting && (
        <AccountDeleteDialog account={account} onClose={() => setDeleting(false)} onDeleted={deleted}
          onBackup={() => { setDeleting(false); openPage?.("DATA", "backup"); }} />
      )}
    </SettingsPage>
  );
};

export default SettingAccount;
