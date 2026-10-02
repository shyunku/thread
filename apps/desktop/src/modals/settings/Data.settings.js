import "./Data.settings.scss";
import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { IoLockClosedOutline } from "react-icons/io5";
import { accountInfoSlice } from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";
import VaultWorkspace from "../../components/VaultWorkspace";
import { SettingsButton, SettingsPage, SettingsSection } from "./SettingsUI";
import SyncStatus from "./data/SyncStatus";
import DataOverview from "./data/DataOverview";
import { vaultCall } from "./data/vaultIpc";

// Vault state decides the layout: unlocked accounts get the data overview;
// locked/absent/broken vaults keep the existing unlock and setup flows.
// Last known vault status per account avoids flashing the locked/setup layout on revisit.
const vaultCache = new Map();
function useVaultStatus(uid) {
  const [vault, setVaultState] = useState(() => vaultCache.get(uid) || null);
  const setVault = useCallback((next) => setVaultState((old) => {
    const value = typeof next === "function" ? next(old) : next;
    vaultCache.set(uid, value);
    return value;
  }), [uid]);
  useEffect(() => {
    if (!IpcSender.vault?.status) { setVault({ unavailable: true }); return undefined; }
    let active = true;
    vaultCall("status").then((value) => { if (active) setVault(value); }).catch(() => { if (active) setVault({ unavailable: true }); });
    let listener = null;
    try {
      listener = IpcSender.onAll?.("vault/status", ({ success, data }) => {
        if (active && success && data?.uid === uid) setVault((old) => ({ ...old, ...data }));
      });
    } catch { /* no IPC bridge (tests, browser preview) */ }
    // Settings stays mounted while hidden; re-check when the app window regains focus.
    const refresh = () => vaultCall("status").then((value) => { if (active) setVault(value); }).catch(() => {});
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      if (listener) IpcSender.off?.("vault/status", listener);
    };
  }, [uid, setVault]);
  return vault;
}

const SettingData = ({ modalRef, preview = false, previewPanel = null }) => {
  const { uid: accountUid } = useSelector(accountInfoSlice);
  const uid = preview ? "settings-preview" : accountUid;
  const vault = useVaultStatus(uid);
  const [locking, setLocking] = useState(false);
  const unlocked = vault?.phase === "UNLOCKED" && (!vault.uid || vault.uid === uid);
  // Until the vault status arrives, show the unlocked layout with skeletons rather than
  // the locked/setup screen; switch only when the status is known.
  const loading = vault === null;

  const lock = () => {
    setLocking(true);
    // The settings modal stays mounted after closing, so reset the flag for the next unlock.
    vaultCall("lock").then(() => modalRef?.current?.close()).catch(() => {}).finally(() => setLocking(false));
  };
  const sync = <SyncStatus uid={uid} preview={preview} />;

  return (
    <SettingsPage title="데이터" description="내 데이터는 기기에서 암호화되어 저장·동기화됩니다."
      action={(unlocked || loading) && (
        <SettingsButton disabled={preview || locking || loading} onClick={lock}>
          <IoLockClosedOutline aria-hidden="true" style={{ marginRight: 6 }} />앱 잠금
        </SettingsButton>
      )}>
      <div className="settings data-settings">
        {unlocked || loading ? (
          <DataOverview uid={uid} vault={vault} ready={unlocked} sync={sync} initialDialog={preview ? previewPanel : null} />
        ) : (
          <>
            <SettingsSection title="동기화">{sync}</SettingsSection>
            <SettingsSection title="데이터 보호">
              <div className="data-settings__vault">
                <VaultWorkspace key={uid} uid={uid} preview={preview} initialPanel={preview ? previewPanel : null} onLocked={() => modalRef?.current?.close()} />
              </div>
            </SettingsSection>
          </>
        )}
      </div>
    </SettingsPage>
  );
};

export default SettingData;
