// Device names (#77), shared by the PC and the phone. A name is an app row like a task
// (`entityType: "deviceName"`, `entityId`: the membership device id, `fields.name`, and
// `fields.model` when the device wrote its own row), so the server only sees ciphertext.
//
// Apps released before 2.4.0 stop every list on a row type they do not know, so writing
// stays off until all of them are updated (2.5.0). This is the one switch for both apps.
const flags = { DEVICE_NAMES_WRITE: false };
const writable = () => flags.DEVICE_NAMES_WRITE === true;

const MAX_LENGTH = 40;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,128}$/;
// C0/C1 controls, line/paragraph separators and bidi overrides: none belong in a label.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
// Default names never include the host name (personal); the PC model stands for it.
const PC_MODEL = "Windows PC";

// The trimmed name, or null when it is not a valid name (1-40 characters, no controls).
function cleanName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  const length = [...name].length;
  if (!length || length > MAX_LENGTH || CONTROL.test(name)) return null;
  return name;
}
function requireName(value) {
  const name = cleanName(value);
  if (!name) throw Error("DEVICE_NAME_INVALID");
  return name;
}
function requireDeviceId(value) {
  if (typeof value !== "string" || !DEVICE_ID.test(value)) throw Error("INVALID_DEVICE_ID");
  return value;
}
function requireWritable() {
  if (!writable()) throw Error("DEVICE_NAMES_DISABLED");
}

// Lists entry for each readable row. Rows a newer app may shape differently are skipped,
// never fatal: this version must keep working whatever a later one writes.
function namesFromRows(rows) {
  return rows
    .filter((row) => row.entityType === "deviceName" && cleanName(row.fields.name))
    .map((row) => ({
      deviceId: row.entityId,
      name: cleanName(row.fields.name),
      model: cleanName(row.fields.model),
    }));
}

// 4 characters people can read out ("4D6B"), the same on both apps.
const shortDeviceId = (id) =>
  String(id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();

// Membership devices with their names. Only current members are shown: names of removed
// devices stay in the vault but are never listed. The own device falls back to its own
// model; another device without a row has no name yet (`name: null`).
// `showId`: the short id goes after the name when two shown names are the same, and
// always for a device without a name.
function withNames(devices, deviceNames, { ownId = null, ownModel = null } = {}) {
  const names = new Map((deviceNames || []).map((entry) => [entry.deviceId, entry]));
  const list = devices.map((device) => {
    const entry = names.get(device.id);
    const model = entry?.model || (device.id === ownId ? cleanName(ownModel) : null);
    return { ...device, name: entry?.name || model || null, model, shortId: shortDeviceId(device.id) };
  });
  const counts = new Map();
  for (const device of list) if (device.name) counts.set(device.name, (counts.get(device.name) || 0) + 1);
  return list.map((device) => ({ ...device, showId: !device.name || counts.get(device.name) > 1 }));
}

// The own row a write device adds once after its first sync (2.5.0): its model as the
// name. A row someone else created first only gets the model, the name stays.
// Returns the mutation [topic, args] to apply, or null when nothing is needed.
function ownNameMutation(deviceNames, { deviceId, role, model }) {
  if (!writable() || role !== "write" || !deviceId) return null;
  const clean = cleanName(model);
  if (!clean) return null;
  const entry = (deviceNames || []).find((item) => item.deviceId === deviceId);
  if (entry?.model) return null;
  return ["device/setDeviceModel", [deviceId, clean]];
}

module.exports = {
  flags,
  writable,
  MAX_LENGTH,
  PC_MODEL,
  cleanName,
  requireName,
  requireDeviceId,
  requireWritable,
  namesFromRows,
  shortDeviceId,
  withNames,
  ownNameMutation,
};
