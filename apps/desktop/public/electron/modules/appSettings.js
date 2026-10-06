// App-wide preferences that main needs (some before "ready"), stored as JSON in userData.
// Dev runs use their own userData (thread-dev), so settings never mix with the installed app.
const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = Object.freeze({
  autoStart: true,
  closeToTray: true,
  hardwareAcceleration: true,
  betaUpdates: false,
  // Show the patch notes window once after an update (#99).
  showPatchNotes: true,
});

function settingsFile(app) {
  return path.join(app.getPath("userData"), "app-settings.json");
}

function sanitize(raw) {
  const value = { ...DEFAULTS };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of Object.keys(DEFAULTS))
      if (typeof raw[key] === "boolean") value[key] = raw[key];
  }
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

function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw Error("INVALID_SETTINGS");
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) => !(key in DEFAULTS) || typeof patch[key] !== "boolean"))
    throw Error("INVALID_SETTINGS");
  return patch;
}

function saveSettings(app, current, patch) {
  const next = sanitize({ ...current, ...validatePatch(patch) });
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
