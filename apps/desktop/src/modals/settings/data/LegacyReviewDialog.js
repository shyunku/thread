import { useCallback, useState } from "react";
import LegacyRecovery from "../../../components/LegacyRecovery";
import LegacyStructureReview from "../../../components/LegacyStructureReview";
import { Segmented, SettingsButton } from "../SettingsUI";
import StepDialog from "./StepDialog";
import { vaultCall } from "./vaultIpc";
import "../../../components/VaultWorkspace.scss";

// Changes left unsent before the v3 update. Reuses the existing review components.
export default function LegacyReviewDialog({ uid, generation, intakes, onClose }) {
  const [selected, setSelected] = useState(intakes[0]?.id || "");
  const loadPage = useCallback((request) => vaultCall("reviews", request), []);
  const reconcile = useCallback((request) => vaultCall("reconcileLegacy", request), []);
  return (
    <StepDialog title="이전 버전 데이터 검토" onClose={onClose}
      footer={<><span /><SettingsButton variant="primary" onClick={onClose}>닫기</SettingsButton></>}>
      <p>업데이트 전에 보내지 못한 변경이에요. 반영하거나 버릴 항목을 고르세요.</p>
      {intakes.length > 1 && (
        <Segmented label="검토 묶음" value={selected} onChange={setSelected}
          options={intakes.map((item, index) => ({ value: item.id, label: `묶음 ${index + 1} · ${item.count}개` }))} />
      )}
      {selected && (
        <div className="vault-workspace">
          <LegacyRecovery key={selected} sessionKey={uid + ":" + generation} intakeId={selected} unlocked loadPage={loadPage} onReconcile={reconcile} />
          <LegacyStructureReview key={"structure:" + selected} intakeId={selected} />
        </div>
      )}
    </StepDialog>
  );
}
