export function relativeTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return null;
  const elapsed = Math.max(0, now - ms);
  if (elapsed < 60 * 1000) return "방금";
  if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / 60000)}분 전`;
  if (elapsed < 24 * 60 * 60 * 1000) return `${Math.floor(elapsed / 3600000)}시간 전`;
  return shortDate(ms);
}

export function shortDate(ms) {
  const date = new Date(ms);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

// 64-char hex codes are compared by people; group them for reading.
export function groupCode(value, size = 8) {
  if (typeof value !== "string") return "";
  return (value.toUpperCase().match(new RegExp(`.{1,${size}}`, "g")) || []).join(" ");
}

export function shortDeviceId(id) {
  return String(id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
}

// Device names (#77). Main sends name (null when the device has none yet), shortId and
// showId; a device without a name reads "다른 기기".
export const deviceName = (device) => device?.name || (device?.own ? "이 PC" : "다른 기기");
export const deviceShortId = (device) => device?.shortId || shortDeviceId(device?.id);
// One line, for dialogs: "회사 노트북", or "Windows PC · 4D6B" when the id is shown.
export const deviceLabel = (device) =>
  device?.showId === false && device?.name ? device.name : `${deviceName(device)} · ${deviceShortId(device)}`;
// After a rename: the short id goes after names that repeat, and after devices without one.
export function withShownIds(devices) {
  const counts = new Map();
  for (const device of devices) if (device.name) counts.set(device.name, (counts.get(device.name) || 0) + 1);
  return devices.map((device) => ({ ...device, showId: !device.name || counts.get(device.name) > 1 }));
}

export const osAuthLabel = () =>
  /Mac/i.test(typeof navigator !== "undefined" ? navigator.platform : "") ? "Touch ID" : "Windows Hello";
