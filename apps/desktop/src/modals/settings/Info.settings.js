import { useState } from "react";
import { IoOpenOutline } from "react-icons/io5";
import PackageJson from "../../../package.json";
import IpcSender from "../../utils/IpcSender";
import { SettingsButton, SettingsCard, SettingsPage, SettingsRow, SettingsSection, Skeleton, Toggle } from "./SettingsUI";
import { useAppSettings } from "./System.settings";
import { relativeTime } from "./data/format";

export const PRIVACY_URL = "https://threadapp.kr/privacy";
export const CONTACT = "shyunku.dev@gmail.com";

const openExternal = (target) => { try { IpcSender.openExternal?.(target, () => {}); } catch { /* no bridge */ } };

const SettingInfo = ({ preview = false }) => {
  const [settings, update] = useAppSettings(preview);
  const [check, setCheck] = useState({ state: "idle" });

  const checkNow = () => {
    if (preview) { setCheck({ state: "done", release: null, at: Date.now() }); return; }
    setCheck({ state: "checking" });
    IpcSender.releaseAlerts.get(({ success, data }) =>
      setCheck(success ? { state: "done", release: data, at: Date.now() } : { state: "failed" }));
  };
  const status = check.state === "checking" ? "확인 중…"
    : check.state === "failed" ? "업데이트를 확인하지 못했어요."
    : check.state === "done" ? (check.release ? `새 버전 ${check.release.version}을 받을 수 있어요.` : `최신 버전입니다 · ${relativeTime(check.at)} 확인`)
    : "업데이트는 자동으로 확인돼요.";

  return (
    <SettingsPage title="정보" description="Thread 버전과 관련 정보입니다.">
      <SettingsCard>
        <SettingsRow label={`버전 ${PackageJson.version}`} description={<span className={check.state === "done" && !check.release ? "settings-ok" : ""}>{status}</span>}>
          {check.state === "done" && check.release
            ? <SettingsButton variant="primary" onClick={() => window.dispatchEvent(new Event("thread:open-update"))}>업데이트 보기</SettingsButton>
            : <SettingsButton disabled={check.state === "checking"} onClick={checkNow}>업데이트 확인</SettingsButton>}
        </SettingsRow>
        <SettingsRow label="베타 버전 받기" description="새 기능을 먼저 받아 봅니다. 불안정할 수 있어요.">
          {settings ? <Toggle label="베타 버전 받기" checked={settings.betaUpdates} onChange={(value) => update({ betaUpdates: value })} />
            : <Skeleton width={38} height={22} />}
        </SettingsRow>
      </SettingsCard>
      <SettingsSection>
        <SettingsCard>
          <SettingsRow label="개인정보처리방침" description="어떤 정보를 어떻게 다루는지 안내합니다.">
            <SettingsButton variant="ghost" onClick={() => openExternal(PRIVACY_URL)}>열기 <IoOpenOutline aria-hidden="true" /></SettingsButton>
          </SettingsRow>
          <SettingsRow label="문의" description={CONTACT}>
            <SettingsButton variant="ghost" onClick={() => openExternal("mailto:" + CONTACT)}>메일 보내기</SettingsButton>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
};

export default SettingInfo;
