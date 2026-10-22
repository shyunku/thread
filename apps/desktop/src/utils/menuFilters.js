import { dayDifference, dueMs } from "./timeDisplay";

// Sidebar menus (#102). The values are ids used across the list code and tests, so the
// older ones keep their strings.
export const TODO_MENU_TYPE = {
  ALL: "모든 할일",
  TODAY: "오늘의 할일",
  NEXT_7_DAYS: "다음 7일의 할일",
  IMPORTANT: "중요한 할일",
};

export const TODO_MENU_LABEL = {
  [TODO_MENU_TYPE.ALL]: "모든 할 일",
  [TODO_MENU_TYPE.TODAY]: "오늘",
  [TODO_MENU_TYPE.NEXT_7_DAYS]: "다음 7일",
  [TODO_MENU_TYPE.IMPORTANT]: "중요",
};

// Sidebar order.
export const TODO_MENU_ORDER = [
  TODO_MENU_TYPE.ALL,
  TODO_MENU_TYPE.TODAY,
  TODO_MENU_TYPE.NEXT_7_DAYS,
  TODO_MENU_TYPE.IMPORTANT,
];

export const isMenuType = (id) => TODO_MENU_ORDER.includes(id);

const dueOf = (task) => dueMs(task?.dueDate);

// A task is secret when any of its categories is secret.
export function isSecretTask(task, categories) {
  for (const cid in task?.categories ?? {}) {
    if (categories?.[cid]?.secret) return true;
  }
  return false;
}

// Whether the task belongs to a built-in menu (no secret check). 오늘 = due today or
// overdue; 다음 7일 = due within 7 days, overdue included.
export function inMenu(menuType, task, now = Date.now()) {
  switch (menuType) {
    case TODO_MENU_TYPE.ALL:
      return true;
    case TODO_MENU_TYPE.TODAY: {
      const due = dueOf(task);
      return due != null && dayDifference(due, now) <= 0;
    }
    case TODO_MENU_TYPE.NEXT_7_DAYS: {
      const due = dueOf(task);
      return due != null && dayDifference(due, now) < 7;
    }
    case TODO_MENU_TYPE.IMPORTANT:
      return task?.important === true;
    default:
      return false;
  }
}

export const isOverdue = (task, now = Date.now()) => {
  const due = dueOf(task);
  return !task?.done && due != null && due < now;
};

// Undone counts for the sidebar. Secret tasks count only while shown (eye on); inside a
// non-secret category they follow the same rule, and secret categories get no count.
// `overdue` turns the 오늘 count red.
export function sidebarCounts(taskMap, categories, { showSecret = false, now = Date.now() } = {}) {
  const counts = {};
  let overdue = false;
  for (const id of TODO_MENU_ORDER) counts[id] = 0;
  for (const task of Object.values(taskMap ?? {})) {
    if (task.done) continue;
    if (!showSecret && isSecretTask(task, categories)) continue;
    for (const id of TODO_MENU_ORDER) if (inMenu(id, task, now)) counts[id]++;
    for (const cid in task.categories ?? {}) {
      if (categories?.[cid] && !categories[cid].secret) counts[cid] = (counts[cid] ?? 0) + 1;
    }
    if (isOverdue(task, now)) overdue = true;
  }
  return { counts, overdue };
}

// Tasks with the category (done ones too) for the delete question, counted the way they are
// visible: hidden secret tasks stay out so the number does not give them away. Inside a secret
// category, which is only open while unlocked, every task counts.
export function categoryTaskCount(taskMap, categories, cid, { showSecret = false } = {}) {
  const secretCategory = !!categories?.[cid]?.secret;
  let n = 0;
  for (const task of Object.values(taskMap ?? {})) {
    if (!task?.categories?.[cid]) continue;
    if (!secretCategory && !showSecret && isSecretTask(task, categories)) continue;
    n++;
  }
  return n;
}
