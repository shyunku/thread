import generated from "../generated/patchNotes.json";

// Patch notes bundled at build time from docs/patchNotes (#99), newest first.
export const KIND_LABEL = { new: "새 기능", improved: "개선", fixed: "수정" };
// From this many versions on, the window lists collapsed version cards.
export const COLLAPSE_AT = 5;

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function compareVersions(a, b) {
  const x = VERSION.exec(a), y = VERSION.exec(b);
  if (!x || !y) return 0;
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] - +y[i];
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0;
  return x[4] < y[4] ? -1 : x[4] > y[4] ? 1 : 0;
}

export function platformNotes(source = generated, userAgent = navigator.userAgent) {
  return (/Macintosh|Mac OS X/.test(userAgent) ? source.mac : source.win) || [];
}

// Notes this build may show: none newer than itself (drafts for the next release are
// bundled too), and no beta notes in an official build: its notes already include them.
export function visibleNotes(notes, current) {
  const official = !current.includes("-");
  return notes.filter((note) => compareVersions(note.version, current) <= 0 && !(official && note.version.includes("-")));
}

// Notes to show after an update: versions after the last shown one, up to the running
// version. seen = null means an update from a version that did not record it: show only
// the running version.
export function pendingNotes(notes, seen, current) {
  const visible = visibleNotes(notes, current);
  if (seen === null) return visible.filter((note) => note.version === current);
  return visible.filter((note) => compareVersions(note.version, seen) > 0);
}
