// The list's sections (#102 mock listBody / groupsNow): date groups or one 해야 할 일 box, then
// 완료됨, and the search sections. Pure functions; tasks are renderer Task objects.
import { DATE_GROUPS, dateGroupOf } from "utils/dateGroups";
import { dueMs } from "utils/timeDisplay";

const DONE = DATE_GROUPS.find((g) => g.id === "done");
const OPEN_GROUPS = DATE_GROUPS.filter((g) => g.id !== "done");
const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

// The order tasks are stored in (the prev/next chain), with any task left off it at the end.
export function storedOrder(taskMap) {
  const all = Object.values(taskMap ?? {});
  const ordered = [];
  const seen = new Set();
  let task = all.find((t) => t.prev == null);
  while (task && !seen.has(task)) {
    seen.add(task);
    ordered.push(task);
    task = task.next;
  }
  for (const t of all) if (!seen.has(t)) ordered.push(t);
  return ordered;
}

// 기한 순: due ascending, no due last (first with noneTop). 생성일 순: newest first. Ties keep the
// stored order (Array.prototype.sort is stable).
export function taskSorter(sort = "due", noneTop = false) {
  if (sort === "created") return (a, b) => time(b.createdAt) - time(a.createdAt);
  return (a, b) => {
    const x = dueMs(a.dueDate), y = dueMs(b.dueDate);
    if (x === null && y === null) return 0;
    if (x === null) return noneTop ? -1 : 1;
    if (y === null) return noneTop ? 1 : -1;
    return x - y;
  };
}

// 완료됨: the most recently completed first.
const doneSorter = (a, b) => time(b.doneAt) - time(a.doneAt);

// [{ id, name, tasks, over }] in display order. Empty groups are left out; 완료됨 holds every done
// task (left out with hideDone).
export function listSections(tasks, { now = Date.now(), weekStart = 0, group = "date", noneTop = false, sort = "due", hideDone = false } = {}) {
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const sorter = taskSorter(sort, noneTop);
  const sections = [];
  if (group === "none") {
    if (open.length) sections.push({ id: "todo", name: "해야 할 일", tasks: [...open].sort(sorter) });
  } else {
    const byGroup = {};
    for (const t of open) {
      const id = dateGroupOf(dueMs(t.dueDate), now, weekStart);
      (byGroup[id] = byGroup[id] || []).push(t);
    }
    const order = noneTop ? [OPEN_GROUPS[OPEN_GROUPS.length - 1], ...OPEN_GROUPS.slice(0, -1)] : OPEN_GROUPS;
    for (const g of order) {
      if (byGroup[g.id]?.length) sections.push({ id: g.id, name: g.name, tasks: byGroup[g.id].sort(sorter), over: g.id === "over" });
    }
  }
  if (done.length && !hideDone) sections.push({ id: DONE.id, name: DONE.name, tasks: [...done].sort(doneSorter) });
  return sections;
}

const lower = (text) => String(text ?? "").toLocaleLowerCase();

// Search sections: 제목에서, 메모에서 (memo only), 카테고리에서 (category name only). Open tasks
// first by due, then done ones. `categoryName(cid)` gives the visible name or null.
export function searchSections(tasks, query, categoryName = () => null, { hideDone = false } = {}) {
  const q = lower(query).trim();
  const result = { title: [], memo: [], category: [] };
  if (!q) return result;
  for (const t of tasks) {
    if (hideDone && t.done) continue;
    if (lower(t.title).includes(q)) result.title.push(t);
    else if (lower(t.memo).includes(q)) result.memo.push(t);
    else if (Object.keys(t.categories ?? {}).some((cid) => lower(categoryName(cid)).includes(q))) result.category.push(t);
  }
  const sorter = taskSorter("due");
  const order = (list) => [...list.filter((t) => !t.done).sort(sorter), ...list.filter((t) => t.done).sort(doneSorter)];
  return { title: order(result.title), memo: order(result.memo), category: order(result.category) };
}

// Splits `text` around case-insensitive matches of `query`: [{ text, hit }].
export function highlightParts(text, query) {
  const source = String(text ?? "");
  const q = String(query ?? "").trim();
  if (!q) return [{ text: source, hit: false }];
  const hay = lower(source), needle = lower(q);
  const parts = [];
  let from = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push({ text: source.slice(from, at), hit: false });
    parts.push({ text: source.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < source.length) parts.push({ text: source.slice(from), hit: false });
  return parts;
}

// The part of a memo around its first match, one line: "…앞 내용 찾은 말 뒤 내용…".
export function memoSnippet(memo, query, around = 16) {
  const text = String(memo ?? "").replace(/\s+/g, " ").trim();
  const at = lower(text).indexOf(lower(query).trim());
  if (at < 0) return text.slice(0, around * 2);
  const start = Math.max(0, at - around);
  const end = Math.min(text.length, at + String(query).trim().length + around);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
