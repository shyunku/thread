import { SettingsCard, SettingsPage, SettingsRow } from "./SettingsUI";

// Layout customization will live in the screens themselves (#70 decision).
const SettingCustom = () => (
  <SettingsPage title="사용자 맞춤" description="화면 구성을 바꿉니다.">
    <SettingsCard>
      <SettingsRow description="현재 조정할 항목이 없습니다. 레이아웃 조정은 화면에서 직접 하도록 준비 중입니다." />
    </SettingsCard>
  </SettingsPage>
);

export default SettingCustom;
