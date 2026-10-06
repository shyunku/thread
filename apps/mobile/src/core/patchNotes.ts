import { Platform } from 'react-native';

// Patch notes bundled at build time from docs/patchNotes (#99), newest first.
export type PatchNote = {
  version: string;
  date: string;
  summary: string;
  sections: {
    kind: 'new' | 'improved' | 'fixed';
    items: { title: string; detail?: string[] }[];
  }[];
};

const generated: {
  android: PatchNote[];
  ios: PatchNote[];
} = require('@/generated/patchNotes.json');

export const APP_VERSION = require('../../package.json').version as string;
export const KIND_LABEL = { new: '새 기능', improved: '개선', fixed: '수정' };
// From this many versions on, the sheet lists collapsed version cards.
export const COLLAPSE_AT = 5;

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function compareVersions(a: string, b: string) {
  const x = VERSION.exec(a),
    y = VERSION.exec(b);
  if (!x || !y) return 0;
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] - +y[i];
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0;
  return x[4] < y[4] ? -1 : x[4] > y[4] ? 1 : 0;
}

export function platformNotes(
  source = generated,
  os: string = Platform.OS,
): PatchNote[] {
  return (os === 'ios' ? source.ios : source.android) ?? [];
}

// Notes this build may show: none newer than itself (drafts for the next release are
// bundled too), and no beta notes in an official build: its notes already include them.
export function visibleNotes(notes: PatchNote[], current: string) {
  const official = !current.includes('-');
  return notes.filter(
    note =>
      compareVersions(note.version, current) <= 0 &&
      !(official && note.version.includes('-')),
  );
}

// Notes to show after an update: versions after the last shown one, up to the running
// version. An empty seen means an update from a version that did not record it: show
// only the running version.
export function pendingNotes(
  notes: PatchNote[],
  seen: string,
  current: string,
) {
  const visible = visibleNotes(notes, current);
  if (!seen) return visible.filter(note => note.version === current);
  return visible.filter(note => compareVersions(note.version, seen) > 0);
}
