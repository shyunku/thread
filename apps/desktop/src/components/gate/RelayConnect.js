import { useCallback, useEffect, useRef, useState } from "react";
import { vaultCall } from "../../modals/settings/data/vaultIpc";
import { GateButton, GateCallout, GateLink, GateStep, SasCode, Waiting } from "./GateFlow";

const KICKER = "쓰던 기기로 연결";
const POLL_MS = 2000;
// A poll can fail briefly (network, busy vault); give up only after several in a row.
const MAX_FAILURES = 4;
const relay = (action, input) => vaultCall("relay", action, input);

function minutesLeft(expiresAt) {
  return expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000)) : null;
}

// New device side of the server-relayed connection (v3-relay-pairing.md).
// Steps 2–4 of the flow; step 1 (lock method) happens before this component.
export default function RelayConnect({ onBack, onOther, onConnected }) {
  const [view, setView] = useState({ phase: "WAITING", code: null, expiresAt: null });
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const paired = useRef(false);
  // Main handles one vault action at a time: never overlap a poll with a user action.
  const inflight = useRef(null);
  const acting = useRef(false);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (!paired.current) relay("cancel").catch(() => {});
    };
  }, []);

  const polling = ["WAITING", "CONNECTING", "COMPARE", "APPROVAL"].includes(view.phase) && !failed;
  useEffect(() => {
    if (!polling) return undefined;
    let timer = null;
    let stopped = false;
    let failures = 0;
    const tick = async () => {
      if (acting.current) { timer = setTimeout(tick, POLL_MS); return; }
      try {
        inflight.current = relay("recipientPoll");
        const next = await inflight.current;
        if (stopped || !live.current) return;
        failures = 0;
        if (next?.phase === "PAIRED") paired.current = true;
        setView((previous) => (next ? { ...previous, ...next } : previous));
      } catch {
        if (stopped || !live.current) return;
        if (++failures >= MAX_FAILURES) { setFailed(true); return; }
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [polling]);

  const act = async (action) => {
    acting.current = true;
    setBusy(true);
    try {
      await inflight.current?.catch(() => {});
      const next = await relay(action);
      if (live.current && next) setView((previous) => ({ ...previous, ...next }));
    } catch {
      if (live.current) setFailed(true);
    } finally {
      acting.current = false;
      if (live.current) setBusy(false);
    }
  };
  const cancelRelay = useCallback(async () => {
    acting.current = true;
    await inflight.current?.catch(() => {});
    await relay("cancel").catch(() => {});
    acting.current = false;
  }, []);
  const restart = useCallback(async () => {
    await cancelRelay();
    if (!live.current) return;
    setFailed(false);
    setView({ phase: "WAITING", code: null, expiresAt: null });
  }, [cancelRelay]);

  const back = async () => { await cancelRelay(); onBack(); };
  const other = <GateLink onClick={async () => { await cancelRelay(); onOther(); }}>QR·파일로 연결</GateLink>;

  if (failed) {
    return (
      <GateStep kicker={KICKER} title="연결하지 못했어요" step={2} total={4} label="쓰던 기기 찾기"
        footer={<>{other}<GateButton variant="primary" onClick={restart}>다시 시도</GateButton></>}>
        <GateCallout tone="danger">서버와 연결하지 못했거나 요청을 처리하지 못했어요. 이 기기와 쓰던 기기 모두 아무것도 바뀌지 않았어요.</GateCallout>
        <p>인터넷 연결을 확인한 뒤 다시 시도하세요. 계속 안 되면 <b>QR·파일로 연결</b>을 써 보세요.</p>
      </GateStep>
    );
  }
  if (view.phase === "MISMATCH") {
    return (
      <GateStep kicker={KICKER} title="연결을 멈췄어요" step={3} total={4} label="숫자 비교"
        footer={<>{other}<GateButton variant="primary" onClick={restart}>다시 시도</GateButton></>}>
        <GateCallout tone="danger">숫자가 달라서 연결을 취소했어요. 이 기기와 쓰던 기기 모두 아무것도 바뀌지 않았어요.</GateCallout>
        <p>두 기기가 같은 계정인지 확인하고 처음부터 다시 시도하세요. 계속 다르게 나오면 다른 네트워크에서 시도하거나 <b>QR·파일로 연결</b>을 써 보세요.</p>
      </GateStep>
    );
  }
  if (view.phase === "EXPIRED" || view.phase === "CANCELLED") {
    return (
      <GateStep kicker={KICKER} title="연결 요청이 끝났어요" step={2} total={4} label="쓰던 기기 찾기"
        footer={<>{other}<GateButton variant="primary" onClick={restart}>다시 시도</GateButton></>}>
        <GateCallout tone="warning">쓰던 기기에서 창을 닫았거나 10분이 지나 요청이 만료됐어요.</GateCallout>
      </GateStep>
    );
  }
  if (view.phase === "PAIRED") {
    return (
      <GateStep kicker={KICKER} title="이 기기가 연결됐어요" step={4} total={4} label="완료"
        footer={<><span /><GateButton variant="primary" onClick={onConnected}>시작하기</GateButton></>}>
        <p className="gate-ok">✓ 쓰던 기기가 이 기기를 승인했어요. 시작하면 데이터를 받아와요.</p>
      </GateStep>
    );
  }
  if (view.phase === "COMPARE") {
    return (
      <GateStep kicker={KICKER} title="숫자를 비교해 주세요" step={3} total={4} label="숫자 비교"
        footer={<>
          <GateButton variant="ghost" disabled={busy} onClick={() => act("recipientReject")}>다른 숫자예요</GateButton>
          <GateButton variant="primary" disabled={busy} onClick={() => act("recipientConfirm")}>같아요</GateButton>
        </>}>
        <p>쓰던 기기 화면에도 <b>같은 숫자</b>가 보이나요?</p>
        <SasCode code={view.code} />
        <p className="gate-muted gate-center">숫자가 다르면 누군가 연결을 가로채려는 것일 수 있어요. 진행하지 마세요.</p>
      </GateStep>
    );
  }
  if (view.phase === "APPROVAL") {
    const left = minutesLeft(view.expiresAt);
    return (
      <GateStep kicker={KICKER} title="쓰던 기기에서 승인해 주세요" step={4} total={4} label="승인 대기"
        footer={<><GateButton variant="ghost" onClick={back}>취소</GateButton><span /></>}>
        <p>쓰던 기기에서 <b>같아요, 승인</b>을 누르고 본인 확인을 마치면 연결이 끝나요.</p>
        <SasCode code={view.code} small />
        <Waiting>승인을 기다리는 중…{left != null && <span className="gate-muted"> · {left}분 뒤 만료</span>}</Waiting>
      </GateStep>
    );
  }
  return (
    <GateStep kicker={KICKER} title="쓰던 기기에서 열어 주세요" step={2} total={4} label="쓰던 기기 찾기"
      footer={<><GateButton variant="ghost" onClick={back}>이전</GateButton>{other}</>}>
      <p>Thread를 쓰고 있는 다른 기기에서 아래 메뉴를 여세요. 열리면 이 화면이 자동으로 넘어가요.</p>
      <div className="gate-path"><span>설정</span>›<span>데이터</span>›<span>새 기기 추가</span></div>
      <Waiting>{view.phase === "CONNECTING" ? "쓰던 기기와 연결하는 중…" : "쓰던 기기를 기다리는 중…"}</Waiting>
      <GateCallout tone="info">두 기기 모두 같은 계정으로 로그인돼 있어야 해요.</GateCallout>
    </GateStep>
  );
}
