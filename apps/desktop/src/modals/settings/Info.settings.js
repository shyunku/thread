import PackageJson from "../../../package.json";
import "./Info.settings.scss";
import { SettingsPage } from "./SettingsUI";

const SettingInfo = ({ ...props }) => {
  return (
    <SettingsPage title="정보" description="Thread 버전과 관련 정보입니다.">
    <div className={"setting-info"}>
      <div className={"info-item"}>
        <div className={"label"}>버전</div>
        <div className={"value"}>{PackageJson.version}</div>
      </div>
      <div className={"info-item"}>
        <div className={"label"}>개발자</div>
        <div className={"value"}>shyunku</div>
      </div>
      <div className={"info-item"}>
        <div className={"label"}>
          Git Contribution을 원하시는 분은 <a href="mailto:shyunku.dev@gmail.com">shyunku.dev@gmail.com</a>으로
          연락바랍니다.
        </div>
      </div>
    </div>
    </SettingsPage>
  );
};

export default SettingInfo;
