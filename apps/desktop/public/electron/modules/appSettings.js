// App-wide preferences that main needs (some before "ready"), stored as JSON in userData.
// Dev runs use their own userData (thread-dev), so settings never mix with the installed app.
const fs = require("node:fs");
const path = require("node:path");
const { normalPeriodReminders, MINUTE_CHOICES } = require("@thread/e2ee/src/model/reminders");

const DEFAULTS = Object.freeze({
  autoStart: true,
  closeToTray: true,
  hardwareAcceleration: true,
  betaUpdates: false,
  // Show the patch notes window once after an update (#99).
  showPatchNotes: true,
  // Due reminders (#91): this PC's own choice, not synced. With the start group (#109):
  // startBefore, startMinutes, startAt.
  reminders: Object.freeze(normalPeriodReminders()),
});

function settingsFile(app) {
  return path.join(app.getPath("userData"), "app-settings.json");
}

function sanitize(raw) {
  const value = { ...DEFAULTS };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of Object.keys(DEFAULTS))
      if (typeof DEFAULTS[key] === "boolean" && typeof raw[key] === "boolean") value[key] = raw[key];
  }
  value.reminders = normalPeriodReminders(raw?.reminders);
  return value;
}

// Synchronous so startup can decide hardware acceleration before the app is ready.
function loadSettings(app) {
  try {
    const stat = fs.statSync(settingsFile(app));
    if (!stat.isFile() || stat.size > 16 * 1024) return { ...DEFAULTS };
    return sanitize(JSON.parse(fs.readFileSync(settingsFile(app), "utf8")));
  } catch {
    return { ...DEFAULTS };
  }
}

// A reminders value: the four end keys, and the start keys (#109) or none of them (an older
// value keeps this PC's start choices).
const END_KEYS = "before,due,enabled,minutes", START_KEYS = "startAt,startBefore,startMinutes";
function validReminders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== END_KEYS && keys !== [...END_KEYS.split(","), ...START_KEYS.split(",")].sort().join(",")) return false;
  return ["before", "due", "enabled"].every((k) => typeof value[k] === "boolean") && MINUTE_CHOICES.includes(value.minutes) &&
    (!("startMinutes" in value) || (["startBefore", "startAt"].every((k) => typeof value[k] === "boolean") && MINUTE_CHOICES.includes(value.startMinutes)));
}

function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw Error("INVALID_SETTINGS");
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) => !(key in DEFAULTS) || (key === "reminders" ? !validReminders(patch[key]) : typeof patch[key] !== "boolean")))
    throw Error("INVALID_SETTINGS");
  return patch;
}

function saveSettings(app, current, patch) {
  validatePatch(patch);
  const next = sanitize({ ...current, ...patch, ...(patch.reminders && { reminders: { ...current?.reminders, ...patch.reminders } }) });
  const file = settingsFile(app);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
  return next;
}

// Process-wide current value: initialized once at startup, updated through update().
let current = null;
let launched = null;
let boundApp = null;
function initSettings(app) {
  boundApp = app;
  current = loadSettings(app);
  launched = { ...current };
  return current;
}
function getSettings() {
  return { ...(current || DEFAULTS) };
}
// Hardware acceleration only changes on the next launch.
function restartRequired() {
  return !!launched && launched.hardwareAcceleration !== getSettings().hardwareAcceleration;
}
function updateSettings(patch) {
  if (!boundApp) throw Error("SETTINGS_NOT_READY");
  current = saveSettings(boundApp, getSettings(), patch);
  return getSettings();
}

module.exports = { DEFAULTS, loadSettings, saveSettings, sanitize, validatePatch, initSettings, getSettings, updateSettings, restartRequired };
