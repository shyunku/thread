// Development-only fixtures for #/__settings-preview. Replaces IpcSender.vault
// with synthetic responses so every data-management screen can be reviewed
// and clicked through without an account, keys, files or the main process.
let LATENCY = 250;
// Device names (#77). names=on: the 2.5.0 state, every device wrote its model and this PC may
// rename; otherwise 2.4.0, where only this PC knows its own model.
const shortId = (id) => id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
const DEVICE_LIST = [
  { id: "4d6be81f-own", role: "write", own: true, addedAt: null, model: "Windows PC" },
  { id: "7be0a1c2-laptop", role: "write", own: false, addedAt: Date.now() - 30 * 86400000, model: "Windows PC" },
  { id: "c90d5b37-phone", role: "write", own: false, addedAt: Date.now() - 27 * 86400000, model: "Galaxy S24" },
  { id: "2a910dd4-tablet", role: "read", own: false, addedAt: Date.now() - 22 * 86400000, model: "Galaxy S24" },
];
const names = new Map();
function devicesFor(namesOn) {
  const list = DEVICE_LIST.map((device) => {
    const model = namesOn || device.own ? device.model : null;
    return { ...device, model, name: names.get(device.id) || model, shortId: shortId(device.id), canRename: namesOn };
  });
  const counts = new Map();
  for (const device of list) if (device.name) counts.set(device.name, (counts.get(device.name) || 0) + 1);
  return list.map((device) => ({ ...device, showId: !device.name || counts.get(device.name) > 1 }));
}
let DEVICES = () => devicesFor(false);
const FINGERPRINT = "4f1c9a7be2d03c58a1f6e9b07d24c3e8a5b19f6d0c7e2a4b8f3d1e6c9a0b5d72";
const RECOVERY_CODE = "THREAD1-F52B8Q4M-7KXN2PVA-9HD3RT6W-JC8LZ5YE-M2QF7BNU-4VXK9RGD-T6WA3HPC-8NYE5JZL";

const reply = (callback, data, success = true) =>
  setTimeout(() => callback?.({ success, data }), LATENCY);

// Multi-step flows keep their phase so the preview can walk through every state.
function phaseFlow(confirmedPhase = "ACTIVE") {
  let phase = null;
  return (action, _input, callback) => {
    if (action === "status") return reply(callback, { phase });
    if (action === "devices") return reply(callback, DEVICES());
    if (action === "prepare") { phase = "RECOVERY_UNCONFIRMED"; return reply(callback, { phase }); }
    if (action === "code") return reply(callback, RECOVERY_CODE);
    if (action === "export") return reply(callback, true);
    if (action === "confirm") { phase = "RECOVERY_CONFIRMED"; return reply(callback, { phase }); }
    if (action === "commit") { phase = confirmedPhase; return reply(callback, { phase }); }
    if (action === "cancel") { phase = null; return reply(callback, { phase }); }
    return reply(callback, null, false);
  };
}

function backupFlow() {
  return (action, input, callback) => {
    if (action === "code") return reply(callback, "BACKUP1-6R2KQ9WM-3HXT7NPA-Z5DC8VJE-2LBF4YGU");
    if (action === "last") return reply(callback, { at: Date.now() - 3 * 86400000, count: 42 });
    if (action === "export") return reply(callback, { phase: "EXPORTED", count: 42 });
    if (action === "restore") return reply(callback, { phase: "REVIEW_REQUIRED", id: "copy-1", count: 42 });
    if (action === "list") return reply(callback, [{ id: "copy-1", phase: "STAGED" }]);
    if (action === "review") return reply(callback, {
      next: input?.after ? null : "page-2", count: 42,
      items: [
        { id: "i1", bucket: "visible", content: { title: "주간 회의 자료 정리", memo: "금요일 오전까지" } },
        { id: "i2", bucket: "server", content: { title: "치과 예약", memo: "" } },
        { id: "i3", bucket: "visible", content: { title: "", memo: "제목 없는 항목" }, deleted: true },
      ],
    });
    if (action === "apply") return reply(callback, { phase: "COPIES_QUEUED", count: 12 });
    return reply(callback, null, false);
  };
}

function reencryptionFlow() {
  let status = null;
  return (action, _input, callback) => {
    if (action === "start") status = { generation: 2, count: 0, pending: true, reason: null, phase: "WAITING" };
    if (action === "status" && status?.phase === "WAITING") status = { ...status, count: status.count + 40, phase: status.count >= 80 ? "DONE" : "WAITING" };
    if (action === "step" && status) status = { ...status, phase: "WAITING" };
    if (action === "cancel" && status) status = { ...status, phase: "CANCELLED" };
    return reply(callback, status);
  };
}

// Relay connection: the new device shows up after a few polls.
function relayFlow() {
  let polls = 0;
  return (action, _input, callback) => {
    if (action === "ownerStart") { polls = 0; return reply(callback, { phase: "WAITING", expiresAt: Date.now() + 600000 }); }
    if (action === "ownerPoll") {
      polls += 1;
      return reply(callback, polls < 3 ? { phase: "WAITING" } : { phase: "COMPARE", code: "482913", role: "write", expiresAt: Date.now() + 540000 });
    }
    if (action === "ownerApprove") return reply(callback, { phase: "DONE" });
    return reply(callback, { phase: "CANCELLED" });
  };
}

function pairingFlow() {
  const request = () => ({ fingerprint: FINGERPRINT, saved: true, expiresAt: Date.now() + 10 * 60 * 1000,
    qr: "thread-pair:v1:" + FINGERPRINT });
  return (action, _input, callback) => {
    if (action === "request" || action === "requestQR") return reply(callback, request());
    if (action === "preview" || action === "previewQR")
      return reply(callback, { requestId: "req-1", fingerprint: FINGERPRINT, role: "write", expiresAt: Date.now() + 9 * 60 * 1000 });
    if (action === "approve") return reply(callback, { approved: true, saved: true });
    if (action === "accept") return reply(callback, { phase: "PAIRED" });
    return reply(callback, null, false);
  };
}

export function installSettingsPreviewIpc(IpcSender, { recovery = "confirmed", latency = 250, deviceNames = false } = {}) {
  LATENCY = latency;
  DEVICES = () => devicesFor(deviceNames);
  IpcSender.req = { ...(IpcSender.req || {}), device: { setDeviceName: (id, name, cb) => {
    if (!deviceNames) return reply(cb, { code: "DEVICE_NAMES_DISABLED" }, false);
    const value = String(name || "").trim();
    if (value) names.set(id, value); else names.delete(id);
    return reply(cb, null);
  } } };
  let identity = { phase: recovery === "confirmed" ? "RECOVERY_CONFIRMED" : "RECOVERY_UNCONFIRMED", fingerprint: FINGERPRINT };
  IpcSender.syncV2 = { ...(IpcSender.syncV2 || {}), retry: (cb) => reply(cb, { ready: true }) };
  // No Electron bridge in the browser preview: event subscriptions are no-ops.
  IpcSender.onAll = () => () => {};
  IpcSender.off = () => {};
  IpcSender.vault = {
    ...(IpcSender.vault || {}),
    status: (cb) => reply(cb, { uid: "settings-preview", phase: "UNLOCKED", generation: 1, osAvailable: true, passwordAvailable: true, enabled: true }),
    intakes: (cb) => reply(cb, []),
    lock: (cb) => reply(cb, true),
    identityStatus: (cb) => reply(cb, identity),
    prepareIdentity: (cb) => reply(cb, identity),
    exportRecovery: (cb) => reply(cb, true),
    recoveryCodePreview: (cb) => reply(cb, "THREAD1-F52B8***-" + Array(7).fill("********").join("-")),
    copyRecoveryCode: (cb) => reply(cb, true),
    confirmRecovery: (_code, cb) => { identity = { ...identity, phase: "RECOVERY_CONFIRMED" }; reply(cb, identity); },
    registrationEndpoint: (cb) => reply(cb, "https://api.threadapp.kr"),
    registerIdentity: (cb) => reply(cb, { phase: "REGISTERED" }),
    rotation: phaseFlow(),
    lostRecovery: phaseFlow(),
    backup: backupFlow(),
    reencryption: reencryptionFlow(),
    pairing: pairingFlow(),
    relay: relayFlow(),
  };
}
