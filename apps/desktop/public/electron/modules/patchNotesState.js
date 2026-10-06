// The last version whose patch notes this install has shown (#99), stored in userData.
// Not secret: only an app version number.
const fs = require("node:fs");
const path = require("node:path");

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function stateFile(userData) {
  return path.join(userData, "patch-notes.json");
}

// Versions before 2.0.10 did not write the file: an install that already has local data
// (the task databases or the encrypted workspace) is an update, otherwise a new install.
function hasExistingData(userData) {
  return ["datafiles", "e2ee"].some((name) => fs.existsSync(path.join(userData, name)));
}

function write(userData, version) {
  const file = stateFile(userData);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify({ seen: version }), { mode: 0o600 });
  fs.renameSync(temp, file);
}

// { seen } for the renderer: the last shown version, or null when the install was updated
// from a version that did not record it. A new install records the current version right
// away, so it shows nothing until the next update.
function readSeen(userData, currentVersion) {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(userData), "utf8"));
    if (raw && typeof raw.seen === "string" && VERSION.test(raw.seen)) return { seen: raw.seen };
  } catch {
    /* Missing or unreadable: decide below. */
  }
  if (hasExistingData(userData)) return { seen: null };
  try {
    write(userData, currentVersion);
  } catch {
    /* Read-only profile: the next start decides again. */
  }
  return { seen: currentVersion };
}

function markSeen(userData, currentVersion) {
  write(userData, currentVersion);
}

module.exports = { readSeen, markSeen, stateFile };
