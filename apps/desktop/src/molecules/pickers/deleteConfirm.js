// The delete questions of the main screen (#102 mock confirmDialog(), confirmed by the user),
// as ConfirmDialog props, so every caller asks with the same words.
const quoted = (name) => `'${name ?? ""}'`;

// 을/를 after a name: by the last Hangul syllable's final consonant; both when it does not end
// in Hangul.
export function objectParticle(name) {
  const code = String(name ?? "").trim().slice(-1).charCodeAt(0);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return "을(를)";
  return (code - 0xac00) % 28 ? "을" : "를";
}

// A task (menu 삭제, the Del key): trash tile, 취소 / 삭제.
export function taskDeleteConfirm(title) {
  return {
    icon: "trash",
    iconColor: "var(--danger)",
    title: "할 일을 삭제할까요?",
    body: `${quoted(title)}${objectParticle(title)} 지워요. 되돌릴 수 없어요.`,
    choices: [{ id: "delete", label: "삭제", danger: true }],
  };
}

// A category, with the number of its tasks the user can see (utils/menuFilters
// categoryTaskCount). A secret one with tasks offers to keep or delete them:
// onChoose gets "category" (take it off the tasks) or "tasks" (delete them too); a plain one
// gets "delete".
export function categoryDeleteConfirm({ title, secret = false, color }, count) {
  const head = `${quoted(title)} 카테고리를 지울까요?`;
  if (secret && count > 0) {
    return {
      icon: "shield",
      iconColor: color,
      title: head,
      body: `할 일 ${count}개에 쓰이고 있어요.`,
      choices: [
        { id: "category", label: "카테고리만 지우기", note: `할 일 ${count}개는 다른 화면에도 보여요` },
        { id: "tasks", label: "할 일까지 지우기", danger: true },
      ],
      defaultId: "category",
    };
  }
  return {
    icon: secret ? "shield" : "trash",
    iconColor: secret ? color : "var(--danger)",
    title: head,
    body: count > 0 ? `할 일 ${count}개에서 빠져요. 할 일은 남아요.` : "이 카테고리를 쓰는 할 일은 없어요.",
    choices: [{ id: "delete", label: "삭제", danger: true }],
  };
}
