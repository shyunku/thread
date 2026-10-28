import Modal from "../molecules/Modal";
import "./Settings.modal.scss";
import {
  IoDesktopOutline,
  IoInformationCircleOutline,
  IoPersonOutline,
  IoSettingsOutline,
  IoShieldOutline,
} from "react-icons/io5";
import { useRef, useState } from "react";
import SettingInfo from "./settings/Info.settings";
import SettingCommon from "./settings/Common.settings";
import SettingData from "./settings/Data.settings";
import SettingAccount from "./settings/Account.settings";
import SettingSystem from "./settings/System.settings";

// Each page renders its own heading (SettingsPage) so it can add page actions.
const SETTING_MENU = {
  GENERAL: { label: "일반", icon: <IoSettingsOutline />, page: (props) => <SettingCommon {...props} /> },
  DATA: { label: "데이터", icon: <IoShieldOutline />, page: (props) => <SettingData {...props} /> },
  SYSTEM: { label: "시스템", icon: <IoDesktopOutline />, page: (props) => <SettingSystem {...props} /> },
  ACCOUNT: { label: "계정", icon: <IoPersonOutline />, page: (props) => <SettingAccount {...props} /> },
  ABOUT: { label: "정보", icon: <IoInformationCircleOutline />, page: (props) => <SettingInfo {...props} /> },
};
const PREVIEW_MENU = { general: "GENERAL", data: "DATA", account: "ACCOUNT", system: "SYSTEM", about: "ABOUT" };

const SettingsModal = ({ preview = false, previewTab, previewPanel, ...props }) => {
  const [activeMenu, setActiveMenu] = useState(preview ? PREVIEW_MENU[previewTab] || "GENERAL" : "GENERAL");
  // A page can open another page with a dialog on it (계정 삭제 -> 데이터 백업, #92).
  const [panel, setPanel] = useState(null);
  const openPage = (menuKey, nextPanel = null) => { setPanel(nextPanel); setActiveMenu(menuKey); };
  const modalRef = useRef(null);

  const onClose = () => {
    return 1234;
  };
  // Backdrop click and Escape close the settings, unless a step dialog is open on top.
  const onCancel = () => {
    if (document.getElementById(`modal-${props.id}`)?.querySelector(".step-dialog__scrim")) return false;
    return onClose();
  };

  return (
    <Modal {...props} active={preview || props.active} onClose={onClose} onCancel={preview ? undefined : onCancel} className={"settings"} ref={modalRef}>
      <div className={"content"}>
        <aside className="settings-sidebar">
          <div className="settings-sidebar__title">설정</div>
          <nav className={"menu"} aria-label="설정 메뉴">
            {Object.keys(SETTING_MENU).map((menuKey) => {
              const menu = SETTING_MENU[menuKey];
              return (
                <button
                  type="button"
                  key={menuKey}
                  className={"menu-item" + (activeMenu === menuKey ? " selected" : "")}
                  aria-current={activeMenu === menuKey ? "page" : undefined}
                  title={menu.label}
                  onClick={() => openPage(menuKey)}
                >
                  <span className={"icon"} aria-hidden="true">{menu.icon}</span>
                  <span className={"label"}>{menu.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <main className={"menu-content"}>
          {SETTING_MENU[activeMenu]?.page?.({ modalRef, preview, previewPanel, panel, openPage })}
        </main>
      </div>
    </Modal>
  );
};

export default SettingsModal;
