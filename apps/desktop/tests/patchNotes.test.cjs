const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const notes = require("../../../scripts/patchNotes.cjs");
const state = require("../public/electron/modules/patchNotesState");

const valid = {
  version: "2.0.10",
  date: "2026-10-20",
  summary: "앱 실행 최적화 및 버그 수정",
  sections: [
    { kind: "fixed", items: [{ title: "자잘한 문제를 고쳤어요." }] },
    { kind: "new", items: [{ title: "업데이트 내역을 볼 수 있어요.", detail: ["한 줄.", "두 줄."] }] },
  ],
};

test("patch notes are validated strictly and sections are ordered new, improved, fixed", () => {
  const out = notes.validate(valid, "docs/patchNotes/desktop/win/2.0.10.json");
  assert.deepEqual(out.sections.map((s) => s.kind), ["new", "fixed"]);
  const bad = [
    [{ ...valid, version: "2.0.11" }, /match the file name/],
    [{ ...valid, date: "20261020" }, /YYYY-MM-DD/],
    [{ ...valid, summary: "두 줄\n요약" }, /one line/],
    [{ ...valid, extra: 1 }, /unknown field/],
    [{ ...valid, sections: [] }, /must not be empty/],
    [{ ...valid, sections: [{ kind: "other", items: [{ title: "x" }] }] }, /kind must be/],
    [{ ...valid, sections: [{ kind: "new", items: [{ title: "x" }] }, { kind: "new", items: [{ title: "y" }] }] }, /appears twice/],
    [{ ...valid, sections: [{ kind: "new", items: [{ title: "x", detail: "한 줄" }] }] }, /list of lines/],
  ];
  for (const [raw, error] of bad) assert.throws(() => notes.validate(raw, "x/2.0.10.json"), error);
  assert.ok(notes.compareVersions("2.0.10", "2.0.9") > 0);
  assert.ok(notes.compareVersions("2.1.0-beta.1", "2.1.0") < 0);
});

test("the bundled patch notes match docs/patchNotes", () => {
  assert.doesNotThrow(() => notes.main(["--check"]));
});

function userData(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-patch-notes-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a new install records the running version; an update without a record shows the running version", (t) => {
  const fresh = userData(t);
  assert.deepEqual(state.readSeen(fresh, "2.0.10"), { seen: "2.0.10" });
  assert.deepEqual(JSON.parse(fs.readFileSync(state.stateFile(fresh), "utf8")), { seen: "2.0.10" });

  const updated = userData(t);
  fs.mkdirSync(path.join(updated, "datafiles"));
  assert.deepEqual(state.readSeen(updated, "2.0.10"), { seen: null });
  assert.equal(fs.existsSync(state.stateFile(updated)), false);
  state.markSeen(updated, "2.0.10");
  assert.deepEqual(state.readSeen(updated, "2.0.11"), { seen: "2.0.10" });

  fs.writeFileSync(state.stateFile(updated), "{broken");
  assert.deepEqual(state.readSeen(updated, "2.0.11"), { seen: null });
  fs.writeFileSync(state.stateFile(updated), JSON.stringify({ seen: "../../x" }));
  assert.deepEqual(state.readSeen(updated, "2.0.11"), { seen: null });
});
