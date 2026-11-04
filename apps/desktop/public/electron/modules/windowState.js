// The main window's last place and size (#106), kept in userData so a restart or a reboot opens
// it where it was. Only the workspace window is remembered: the login and lock screens use their
// own fixed sizes and never overwrite it.
const fs = require("node:fs");
const path = require("node:path");

const MIN = { width: 400, height: 300 };

function stateFile(app) {
  return path.join(app.getPath("userData"), "window-state.json");
}

function sanitize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { x, y, width, height } = raw;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < MIN.width || height < MIN.height || width > 20000 || height > 20000) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), maximized: raw.maximized === true };
}

function loadWindowState(app) {
  try {
    const file = stateFile(app), stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 4096) return null;
    return sanitize(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function saveWindowState(app, state) {
  const value = sanitize(state);
  if (!value) return false;
  const file = stateFile(app), temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value), "utf8");
    fs.renameSync(temp, file);
    return true;
  } catch {
    try { fs.rmSync(temp, { force: true }); } catch {}
    return false;
  }
}

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// Where the saved window goes on the displays connected now: on the work area it overlaps most
// (the primary one when it overlaps none, e.g. a monitor was unplugged), shrunk to fit and moved
// fully inside it.
function placeWindow(state, workAreas, primary) {
  let area = primary, best = 0;
  for (const candidate of workAreas) {
    const size = overlap(state, candidate);
    if (size > best) { best = size; area = candidate; }
  }
  const width = Math.min(state.width, area.width), height = Math.min(state.height, area.height);
  const x = Math.min(Math.max(state.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(state.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

module.exports = { loadWindowState, saveWindowState, placeWindow, sanitize };
