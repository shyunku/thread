import PackageJson from "../../../package.json";
import "./Info.settings.scss";
import { useState } from "react";
import CheckBox from "../../molecules/CheckBox";

const SettingCommon = ({ ...props }) => {
  const [startOnBoot, setStartOnBoot] = useState(false);

  return (
    <div className="settings-empty">
      현재 조정할 항목이 없습니다.
      {/*<div className={"setting-item"}>*/}
      {/*  <div className={"head"}>*/}
      {/*    <div className={"label"}>부팅 시 자동 시작</div>*/}
      {/*    <div className={"controller"}>*/}
      {/*      <CheckBox value={startOnBoot} onChange={setStartOnBoot} />*/}
      {/*    </div>*/}
      {/*  </div>*/}
      {/*  <div className={"description"}>부팅 시 자동 시작됩니다.</div>*/}
      {/*</div>*/}
    </div>
  );
};

export default SettingCommon;
