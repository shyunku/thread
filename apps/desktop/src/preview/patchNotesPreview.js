// Dev-only synthetic patch notes for screenshots (#99). Versions count down from the
// running version so the after-update window has something to show.
import PackageJson from "../../package.json";

const TEXT = [
  ["앱 실행 최적화 및 동기화 오류 수정", [
    { kind: "improved", items: [{ title: "앱 실행이 빨라졌어요.", detail: ["할 일이 많아도 처음 열 때 기다리는 시간이 크게 줄었어요."] }] },
    { kind: "fixed", items: [{ title: "동기화 오류를 고쳤어요.", detail: ["여러 번 껐다 켜면 동기화가 멈추던 문제를 고쳤어요."] }] }]],
  ["캘린더 UI 개선", [{ kind: "improved", items: [{ title: "캘린더가 보기 편해졌어요.", detail: ["완료한 일이 덜 돋보이게 바꿨어요."] }] }]],
  ["업데이트 내역 추가", [{ kind: "new", items: [{ title: "업데이트 내역을 볼 수 있어요.", detail: ["업데이트하면 바뀐 점을 이 창에서 알려 드려요.", "\"다시 보지 않기\"를 선택해도 설정에서 다시 켜거나 끌 수 있어요."] }] }]],
  ["화면 디자인 개선", [{ kind: "improved", items: [{ title: "쓰기 더 편해졌어요.", detail: ["전체적인 화면 디자인을 다듬었어요."] }] }]],
  ["버그 수정", [{ kind: "fixed", items: [{ title: "자잘한 문제를 고쳤어요." }] }]],
  ["로그인 안정성 개선", [{ kind: "fixed", items: [{ title: "로그인이 가끔 풀리던 문제를 고쳤어요." }] }]],
  ["반복 할 일 알림 수정", [{ kind: "fixed", items: [{ title: "반복 할 일 알림이 늦게 오던 문제를 고쳤어요." }] }]],
];

export function patchNotesPreview(params) {
  const [major, minor, patch] = PackageJson.version.split("-")[0].split(".").map(Number);
  const notes = TEXT.map(([summary, sections], i) => ({
    version: `${major}.${minor}.${patch - i}`, date: `2026-10-${String(20 - i).padStart(2, "0")}`, summary, sections,
  })).filter((note) => !/-/.test(note.version));
  const count = Math.min(Number(params.get("count")) || 1, notes.length - 1);
  return { mode: params.get("patchNotes") === "history" ? "history" : "update", notes, seen: notes[count].version };
}
