import { useDispatch, useSelector } from "react-redux";
import { prefsSelector, setPrefs } from "../../store/prefsSlice";
import { Segmented, SettingsCard, SettingsPage, SettingsRow, Skeleton, Soon, Toggle } from "./SettingsUI";
import { useAppSettings } from "./System.settings";

const SettingCommon = ({ preview = false }) => {
  const prefs = useSelector(prefsSelector);
  const [settings, update] = useAppSettings(preview);
  const dispatch = useDispatch();
  const set = (patch) => dispatch(setPrefs(patch));
  return (
    <SettingsPage title="일반" description="앱의 기본 동작을 정합니다.">
      <SettingsCard>
        <SettingsRow label="시작할 때 보기" description="앱을 열면 처음 보여 줄 화면">
          <Segmented label="시작할 때 보기" value={prefs.startView} onChange={(startView) => set({ startView })}
            options={[{ value: "list", label: "리스트" }, { value: "calendar", label: "캘린더" }, { value: "timeline", label: "타임라인" }]} />
        </SettingsRow>
        <SettingsRow label="주 시작 요일" description="캘린더의 첫 번째 열">
          <Segmented label="주 시작 요일" value={prefs.weekStart} onChange={(weekStart) => set({ weekStart })}
            options={[{ value: 0, label: "일요일" }, { value: 1, label: "월요일" }]} />
        </SettingsRow>
        <SettingsRow label="시간 표시" description="오후 3시 / 15시">
          <Segmented label="시간 표시" value={prefs.timeFormat} onChange={(timeFormat) => set({ timeFormat })}
            options={[{ value: "12", label: "12시간" }, { value: "24", label: "24시간" }]} />
        </SettingsRow>
        <SettingsRow label={<>테마<Soon /></>} description="다크, 라이트, 시스템 설정 따르기">
          <Segmented label="테마" value="dark" disabled
            options={[{ value: "dark", label: "다크" }, { value: "light", label: "라이트" }, { value: "system", label: "시스템" }]} />
        </SettingsRow>
        <SettingsRow label="업데이트 후 변경 내용 보기" description="새 버전으로 바뀐 뒤 처음 열 때 바뀐 점을 창으로 보여 줘요.">
          {settings ? <Toggle label="업데이트 후 변경 내용 보기" checked={settings.showPatchNotes !== false} onChange={(value) => update({ showPatchNotes: value })} />
            : <Skeleton width={38} height={22} />}
        </SettingsRow>
      </SettingsCard>
    </SettingsPage>
  );
};

export default SettingCommon;
