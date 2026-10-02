import { useCallback, useEffect, useRef, useState } from "react";
import { IoCubeOutline, IoDesktopOutline, IoKeyOutline } from "react-icons/io5";
import { Badge, SettingsButton, SettingsCard, SettingsRow, SettingsSection, Skeleton } from "../SettingsUI";
import { Callout } from "./StepDialog";
import { vaultAction, vaultCall } from "./vaultIpc";
import { shortDate, shortDeviceId } from "./format";
import AddDeviceDialog from "./AddDeviceDialog";
import KeyChangeDialog from "./KeyChangeDialog";
import BackupDialog from "./BackupDialog";
import RecoverySetupDialog from "./RecoverySetupDialog";
import LegacyReviewDialog from "./LegacyReviewDialog";

const ROTATION_PENDING = ["RECOVERY_UNCONFIRMED", "RECOVERY_CONFIRMED", "COMMITTING"];
const REENCRYPTION_ACTIVE = ["READY", "WAITING", "PAUSED"];
const softly = (promise) => promise.catch(() => undefined);
// Last loaded values per account: revisiting the tab shows them at once and refreshes behind.
const overviewCache = new Map();

// Unlocked data tab: protection summary, sync (passed in), devices, backup & recovery.
// Vault actions run one at a time in main, so the initial loads are sequential.
// Dev preview deep links (?panel=) open a dialog directly.
const PREVIEW_DIALOGS = { pair: { type: "add" }, add: { type: "add" }, rotation: { type: "key", mode: "renew" },
  renew: { type: "key", mode: "renew" }, backup: { type: "backup" }, recovery: { type: "recovery" } };

export default function DataOverview({ uid, vault, ready = true, sync, initialDialog = null }) {
  const cached = overviewCache.get(uid) || {};
  const [identity, setIdentity] = useState(cached.identity);
  const [devices, setDevices] = useState(cached.devices);
  const [lastBackup, setLastBackup] = useState(cached.lastBackup);
  const [rotation, setRotation] = useState(cached.rotation ?? null);
  const [reencryption, setReencryption] = useState(cached.reencryption ?? null);
  const [intakes, setIntakes] = useState(cached.intakes || []);
  const [dialog, setDialog] = useState(null);
  const [resuming, setResuming] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const load = useCallback(async () => {
    const id = await softly(vaultCall("identityStatus"));
    if (!live.current) return;
    setIdentity(id ?? null);
    const rotationStatus = await softly(vaultAction("rotation", "status"));
    const reencryptionStatus = await softly(vaultAction("reencryption", "status"));
    const backup = await softly(vaultAction("backup", "last"));
    const pending = await softly(vaultCall("intakes"));
    if (!live.current) return;
    setRotation(rotationStatus ?? null);
    setReencryption(reencryptionStatus ?? null);
    setLastBackup(backup ?? null);
    setIntakes(pending || []);
    if (id?.phase === "RECOVERY_CONFIRMED") {
      try {
        const list = await vaultAction("rotation", "devices");
        if (live.current) setDevices(list);
      } catch { if (live.current) setDevices(null); }
    } else setDevices(null);
  }, []);
  useEffect(() => { if (ready) void load(); }, [load, uid, ready]);
  useEffect(() => {
    overviewCache.set(uid, { identity, devices, lastBackup, rotation, reencryption, intakes });
  }, [uid, identity, devices, lastBackup, rotation, reencryption, intakes]);
  useEffect(() => {
    if (PREVIEW_DIALOGS[initialDialog]) setDialog(PREVIEW_DIALOGS[initialDialog]);
  }, [initialDialog]);
  useEffect(() => {
    const other = devices?.find((device) => !device.own);
    if (initialDialog === "remove" && other) setDialog((current) => current || { type: "key", mode: "remove", device: other });
  }, [initialDialog, devices]);

  const resumeReencryption = async () => {
    setResuming(true);
    try { const status = await vaultAction("reencryption", "step", { confirmed: true }); if (live.current) setReencryption(status); }
    catch { /* stays paused; the callout remains */ }
    finally { if (live.current) setResuming(false); }
  };

  const owner = !!identity && identity.phase === "RECOVERY_CONFIRMED";
  const close = () => setDialog(null);
  const osAvailable = !!vault?.osAvailable;
  const loading = { loading: true };
  const recoveryCell = identity === undefined ? loading
    : identity === null ? { value: "다른 기기에서 관리", sub: "처음 만든 기기에서 관리해요" }
    : identity.recoveryStale ? { value: "⚠ 다시 만들어야 해요", tone: "warning", sub: "다른 기기에서 열쇠가 바뀌었어요", action: ["새로 만들기", () => setDialog({ type: "key", mode: "renew" })] }
    : identity.phase === "RECOVERY_CONFIRMED" ? { value: "✓ 보관됨", tone: "success", sub: "확인 완료" }
    : { value: "⚠ 확인 필요", tone: "warning", sub: "모든 기기를 잃으면 되찾을 수 없어요", action: ["지금 설정", () => setDialog({ type: "recovery" })] };
  const devicesCell = devices === undefined ? loading
    : devices === null ? { value: "—", sub: owner ? "목록을 불러오지 못했어요" : "처음 만든 기기에서 볼 수 있어요" }
    : { value: `${devices.length}대`, sub: "이 PC 포함" };
  const backupCell = lastBackup === undefined ? loading
    : lastBackup ? { value: shortDate(lastBackup.at), sub: `${lastBackup.count}개 항목` }
    : { value: "⚠ 없음", tone: "warning", action: ["백업 만들기", () => setDialog({ type: "backup" })] };

  return (
    <div className="data-overview">
      <SettingsCard className="data-summary">
        {[["복구 키", <IoKeyOutline />, recoveryCell], ["연결된 기기", <IoDesktopOutline />, devicesCell], ["마지막 백업", <IoCubeOutline />, backupCell]].map(([title, icon, cell]) => (
          <div className="data-summary__cell" key={title}>
            <div className="data-summary__title">{icon}{title}</div>
            {cell.loading ? (
              <><div className="data-summary__value"><Skeleton width="56%" height={20} /></div><div className="data-summary__sub"><Skeleton width="40%" height={12} /></div></>
            ) : <div className={"data-summary__value" + (cell.tone ? " data-summary__value--" + cell.tone : "")}>{cell.value}</div>}
            {!cell.loading && (cell.sub || cell.action) && (
              <div className="data-summary__sub">
                {cell.sub}{cell.sub && cell.action ? " · " : ""}
                {cell.action && <SettingsButton variant="link" onClick={cell.action[1]}>{cell.action[0]}</SettingsButton>}
              </div>
            )}
          </div>
        ))}
      </SettingsCard>

      {ROTATION_PENDING.includes(rotation?.phase) && (
        <Callout>
          열쇠 교체를 아직 마치지 않았어요.{" "}
          <SettingsButton variant="link" onClick={() => setDialog({ type: "key", mode: rotation.removed?.length ? "remove" : "renew", resume: rotation.phase, device: rotation.removed?.[0] ? { id: rotation.removed[0] } : null })}>이어서 하기</SettingsButton>
        </Callout>
      )}
      {REENCRYPTION_ACTIVE.includes(reencryption?.phase) && (
        reencryption.phase === "PAUSED" ? (
          <Callout>기존 데이터를 새 열쇠로 다시 보호하는 작업이 멈췄어요.{" "}
            <SettingsButton variant="link" disabled={resuming} onClick={resumeReencryption}>{resuming ? "다시 시도하는 중…" : "다시 시도"}</SettingsButton>
          </Callout>
        ) : <Callout tone="info">기존 데이터를 새 열쇠로 다시 보호하고 있어요 · {reencryption.count ?? 0}개 처리</Callout>
      )}

      <SettingsSection title="동기화">{sync}</SettingsSection>

      {(owner || identity === undefined) && (
        <SettingsSection title="연결된 기기"
          action={<SettingsButton onClick={() => setDialog({ type: "add" })}>+ 새 기기 추가</SettingsButton>}>
          <SettingsCard>
            {devices === undefined && [0, 1].map((index) => (
              <SettingsRow key={index} icon={<IoDesktopOutline />} label={<Skeleton width={120} />} description={<Skeleton width={160} height={12} />} />
            ))}
            {devices === null && (
              <SettingsRow description="기기 목록을 불러오지 못했어요. 연결을 확인해 주세요.">
                <SettingsButton onClick={() => void load()}>다시 시도</SettingsButton>
              </SettingsRow>
            )}
            {devices?.map((device) => (
              <SettingsRow key={device.id} icon={<IoDesktopOutline />}
                label={device.own ? "이 PC" : `다른 기기 · ${shortDeviceId(device.id)}`}
                description={[device.role === "read" ? "보기만 가능" : "편집 가능", device.own ? "현재 사용 중" : device.addedAt ? `${shortDate(device.addedAt)} 연결` : null].filter(Boolean).join(" · ")}>
                {device.own ? <Badge>이 기기</Badge>
                  : <SettingsButton variant="danger" onClick={() => setDialog({ type: "key", mode: "remove", device })}>해제</SettingsButton>}
              </SettingsRow>
            ))}
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection title="백업과 복구">
        <SettingsCard>
          <SettingsRow icon={<IoCubeOutline />} label="데이터 백업" description="할 일 전체를 암호화된 파일로 내보내거나 불러옵니다.">
            <SettingsButton onClick={() => setDialog({ type: "backup" })}>백업 관리</SettingsButton>
          </SettingsRow>
          <SettingsRow icon={<IoKeyOutline />} label="복구 키" description="모든 기기를 잃었을 때 데이터를 되찾는 파일과 코드입니다.">
            {identity && (identity.phase === "RECOVERY_CONFIRMED"
              ? <SettingsButton onClick={() => setDialog({ type: "key", mode: "renew" })}>새로 만들기</SettingsButton>
              : <SettingsButton onClick={() => setDialog({ type: "recovery" })}>설정하기</SettingsButton>)}
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      {intakes.length > 0 && (
        <details className="data-overview__advanced">
          <summary>고급</summary>
          <SettingsCard>
            <SettingsRow label="이전 버전 데이터 검토" description={`업데이트 전에 보내지 못한 변경 ${intakes.reduce((sum, item) => sum + (item.count || 0), 0)}개가 남아 있어요.`}>
              <SettingsButton onClick={() => setDialog({ type: "legacy" })}>검토</SettingsButton>
            </SettingsRow>
          </SettingsCard>
        </details>
      )}

      {dialog?.type === "add" && <AddDeviceDialog vaultCode={identity?.fingerprint} osAvailable={osAvailable} onClose={close} onChanged={load} />}
      {dialog?.type === "key" && <KeyChangeDialog mode={dialog.mode} device={dialog.device} resumePhase={dialog.resume} osAvailable={osAvailable} onClose={close} onChanged={load} />}
      {dialog?.type === "backup" && <BackupDialog osAvailable={osAvailable} onClose={close} onChanged={load} />}
      {dialog?.type === "recovery" && <RecoverySetupDialog onClose={close} onChanged={load} />}
      {dialog?.type === "legacy" && <LegacyReviewDialog uid={uid} generation={vault?.generation} intakes={intakes} onClose={() => { close(); void load(); }} />}
    </div>
  );
}
