const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const settings = require("../public/electron/modules/appSettings");
const { isAllowedExternal } = require("../public/electron/modules/externalLinks");

function fakeApp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-settings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, getPath: (name) => { assert.equal(name, "userData"); return dir; } };
}

test("settings default safely, ignore unknown or mistyped keys and survive corrupt files", (t) => {
  const app = fakeApp(t);
  assert.deepEqual(settings.loadSettings(app), settings.DEFAULTS);
  fs.writeFileSync(path.join(app.dir, "app-settings.json"), JSON.stringify({ autoStart: false, closeToTray: "no", evil: true }));
  assert.deepEqual(settings.loadSettings(app), { ...settings.DEFAULTS, autoStart: false });
  fs.writeFileSync(path.join(app.dir, "app-settings.json"), "{not json");
  assert.deepEqual(settings.loadSettings(app), settings.DEFAULTS);
});

test("updates persist only valid boolean keys and flag a restart for hardware acceleration", (t) => {
  const app = fakeApp(t);
  settings.initSettings(app);
  assert.equal(settings.restartRequired(), false);
  assert.throws(() => settings.updateSettings({ autoStart: "false" }), /INVALID_SETTINGS/);
  assert.throws(() => settings.updateSettings({ unknown: true }), /INVALID_SETTINGS/);
  assert.throws(() => settings.updateSettings({}), /INVALID_SETTINGS/);
  const next = settings.updateSettings({ hardwareAcceleration: false, betaUpdates: true });
  assert.equal(next.hardwareAcceleration, false);
  assert.equal(settings.restartRequired(), true);
  assert.deepEqual(settings.loadSettings(app), next);
  assert.equal(fs.existsSync(path.join(app.dir, "app-settings.json.tmp")), false);
  settings.updateSettings({ hardwareAcceleration: true });
  assert.equal(settings.restartRequired(), false);
});

test("only Thread's HTTPS site and the contact address can be opened externally", () => {
  for (const ok of ["https://threadapp.kr/privacy", "https://www.threadapp.kr/", "mailto:shyunku.support@gmail.com"])
    assert.equal(isAllowedExternal(ok), true, ok);
  for (const bad of ["http://threadapp.kr", "https://threadapp.kr.evil.example", "https://evil.example/threadapp.kr",
    "https://user@threadapp.kr", "https://threadapp.kr:8443/", "file:///C:/Windows", "javascript:alert(1)",
    "mailto:someone@example.com", "", null, "https://threadapp.kr/" + "a".repeat(600)])
    assert.equal(isAllowedExternal(bad), false, String(bad));
});

test("release alerts are checked again when the main window regains focus", async () => {
  const { ReleaseAlertService } = require("../public/electron/service/releaseAlert.service");
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.webContents = { send: () => {} };
  let checks = 0;
  const service = new ReleaseAlertService();
  service.inject({ windowService: { mainWindow: window }, updaterService: { latestTrustedRelease: async () => { checks++; return null; } } });
  service.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1);
  window.emit("focus");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 2);
  clearInterval(service.timer);
});
