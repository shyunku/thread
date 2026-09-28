import Modal from "../molecules/Modal";
import "./Settings.modal.scss";
import {
  IoCog,
  IoInformationCircle,
  IoLogoBuffer,
  IoPersonSharp,
} from "react-icons/io5";
import { useEffect, useRef, useState } from "react";
import JsxUtil from "../utils/JsxUtil";
import SettingInfo from "./settings/Info.settings";
import { MdOutlineDashboardCustomize } from "react-icons/md";
import SettingCommon from "./settings/Common.settings";
import SettingData from "./settings/Data.settings";
import SettingAccount from "./settings/Account.settings";

const SETTING_MENU = {
  GENERAL: {
    key: "일반",
    description: "앱의 기본 동작을 확인합니다.",
    icon: <IoCog />,
    page: (props) => <SettingCommon {...props} />,
  },
  DATA: {
    key: "데이터",
    description: "데이터 보호와 동기화 상태를 확인하고 필요한 작업을 관리합니다.",
    icon: <IoLogoBuffer />,
    page: (props) => <SettingData {...props} />,
  },
  CUSTOM: {
    key: "사용자 맞춤",
    description: "화면과 사용 방식을 확인합니다.",
    icon: <MdOutlineDashboardCustomize />,
    page: () => <div className="settings-empty">현재 조정할 항목이 없습니다.</div>,
  },
  ACCOUNT: {
    key: "계정",
    description: "로그인한 계정을 관리합니다.",
    icon: <IoPersonSharp />,
    page: (props) => <SettingAccount {...props} />,
  },
  ABOUT: {
    key: "정보",
    description: "Thread의 버전과 개발 정보를 확인합니다.",
    icon: <IoInformationCircle />,
    page: (props) => <SettingInfo {...props} />,
  },
};
const PREVIEW_MENU = { general: "GENERAL", data: "DATA", custom: "CUSTOM", account: "ACCOUNT", about: "ABOUT" };

const SettingsModal = ({ preview = false, previewTab, ...props }) => {
  const [activeMenu, setActiveMenu] = useState(preview ? PREVIEW_MENU[previewTab] || "GENERAL" : "GENERAL");
  const previewVault = preview && new URLSearchParams(window.location.hash.split("?")[1] || "").get("vault") === "1";

  const modalRef = useRef(null);

  useEffect(() => {
    if (previewVault && activeMenu === "DATA") {
      requestAnimationFrame(() => {
        document.querySelector("#modal-SETTINGS_PREVIEW .data-settings__manage")?.scrollIntoView({ block: "start" });
      });
    }
  }, [previewVault, activeMenu]);

  const onClose = () => {
    return 1234;
  };

  return (
    <Modal {...props} active={preview || props.active} onClose={onClose} className={"settings"} ref={modalRef}>
      <div className="settings-header"><h1 className="title">환경설정</h1></div>
      <div className={"content"}>
        <nav className={"menu"} aria-label="설정 메뉴">
          <div className="menu-caption">앱 설정</div>
          {Object.keys(SETTING_MENU).map((menuKey) => {
            const menu = SETTING_MENU[menuKey];
            return (
              <button
                type="button"
                key={menu.key}
                className={
                  "menu-item" +
                  JsxUtil.classByEqual(activeMenu, menuKey, "selected")
                }
                aria-current={activeMenu === menuKey ? "page" : undefined}
                onClick={() => setActiveMenu(menuKey)}
              >
                <div className={"icon"}>{menu.icon}</div>
                <div className={"label"}>{menu.key}</div>
              </button>
            );
          })}
        </nav>
        <main className={"menu-content"}>
          <header className="settings-page-heading">
            <h2>{SETTING_MENU[activeMenu]?.key}</h2>
            <p>{SETTING_MENU[activeMenu]?.description}</p>
          </header>
          {SETTING_MENU[activeMenu]?.page?.({ modalRef, preview, previewVault }) ?? (
            <div>페이지가 없습니다.</div>
          )}
        </main>
      </div>
    </Modal>
  );
};

export default SettingsModal;
