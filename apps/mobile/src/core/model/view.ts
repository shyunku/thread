// Screen-side view of the shared application lists (packages/e2ee entityLists):
// same filters, sort modes and wording as the desktop TodoContent.
export type TaskRow = {
  tid: string;
  title: string;
  memo: string;
  done: boolean;
  doneAt: number;
  dueDate: number | null;
  repeatPeriod: '' | 'day' | 'week' | 'month' | 'year';
  recurrenceGeneration: string;
  createdAt: number;
  sortRank: bigint;
  important: boolean;
  categories: string[];
  subtasks: SubtaskRow[];
};
export type SubtaskRow = {
  sid: string;
  tid: string;
  title: string;
  done: boolean;
  dueDate: number | null;
  createdAt: number;
};
export type CategoryRow = {
  cid: string;
  title: string;
  color: string;
  secret: boolean;
  locked: boolean;
  createdAt: number;
};
export type Lists = {
  tasks: any[];
  subtasks: any[];
  categories: any[];
  relations: { tid: string; cid: string }[];
};

export type Scope =
  | { kind: 'all' }
  | { kind: 'today' }
  | { kind: 'important' }
  | { kind: 'category'; cid: string };
export type SortMode = 'due' | 'remaining' | 'created';

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

export function buildModel(lists: Lists) {
  const categories: CategoryRow[] = lists.categories
    .map(c => ({
      cid: c.cid,
      title: c.title ?? '',
      color: c.color ?? '',
      secret: !!c.secret,
      locked: !!c.locked,
      createdAt: num(c.created_at),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
  const subtasksByTask = new Map<string, SubtaskRow[]>();
  for (const s of lists.subtasks) {
    const row = {
      sid: s.sid,
      tid: s.tid,
      title: s.title ?? '',
      done: !!s.done,
      dueDate: num(s.due_date) || null,
      createdAt: num(s.created_at),
    };
    subtasksByTask.set(s.tid, [...(subtasksByTask.get(s.tid) ?? []), row]);
  }
  for (const list of subtasksByTask.values())
    list.sort((a, b) => a.createdAt - b.createdAt);
  const categoriesByTask = new Map<string, string[]>();
  for (const r of lists.relations)
    categoriesByTask.set(r.tid, [
      ...(categoriesByTask.get(r.tid) ?? []),
      r.cid,
    ]);
  const tasks: TaskRow[] = lists.tasks.map(t => ({
    tid: t.tid,
    title: t.title ?? '',
    memo: t.memo ?? '',
    done: !!t.done,
    doneAt: num(t.done_at),
    dueDate: num(t.due_date) || null,
    repeatPeriod: t.repeat_period || '',
    recurrenceGeneration: t.recurrence_generation ?? '0',
    createdAt: num(t.created_at),
    sortRank: BigInt(t.sort_rank ?? '0'),
    // Starred (#97); a task without the key is not.
    important: t.important === true,
    categories: categoriesByTask.get(t.tid) ?? [],
    subtasks: subtasksByTask.get(t.tid) ?? [],
  }));
  return {
    tasks,
    categories,
    categoryMap: new Map(categories.map(c => [c.cid, c])),
  };
}
export type Model = ReturnType<typeof buildModel>;

const sameDay = (a: number, b: number) => {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
};

export function visibleTasks(
  model: Model,
  scope: Scope,
  { now = Date.now(), query = '' } = {},
) {
  const q = query.trim().toLocaleLowerCase();
  return model.tasks.filter(task => {
    if (
      scope.kind === 'today' &&
      !(task.dueDate != null && sameDay(task.dueDate, now))
    )
      return false;
    if (scope.kind === 'important' && !task.important) return false;
    if (scope.kind === 'category' && !task.categories.includes(scope.cid))
      return false;
    // A task in a secret category only shows inside that category (desktop secretFilter).
    const viewing = scope.kind === 'category' ? scope.cid : null;
    if (
      task.categories.some(
        cid => cid !== viewing && model.categoryMap.get(cid)?.secret,
      )
    )
      return false;
    if (!q) return true;
    const text = [
      task.title,
      task.memo,
      ...task.categories.map(cid => model.categoryMap.get(cid)?.title ?? ''),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return text.includes(q);
  });
}

const byDue = (a: TaskRow, b: TaskRow) =>
  a.dueDate == null && b.dueDate == null
    ? 0
    : a.dueDate == null
    ? 1
    : b.dueDate == null
    ? -1
    : a.dueDate - b.dueDate;

export function sortTasks(tasks: TaskRow[], mode: SortMode) {
  const list = [...tasks];
  if (mode === 'due') return list.sort(byDue);
  if (mode === 'remaining') return list.sort((a, b) => -byDue(a, b) || 0);
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

// "2시간 남음" / "3일 지남", the largest unit only (desktop fromRelativeTime, one layer).
export function remainingText(dueDate: number | null, now = Date.now()) {
  if (dueDate == null) return null;
  const diff = dueDate - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [365 * 86400000, '년'],
    [30 * 86400000, '개월'],
    [86400000, '일'],
    [3600000, '시간'],
    [60000, '분'],
    [1000, '초'],
  ];
  const [size, label] = units.find(([unit]) => abs >= unit) ?? [1000, '초'];
  return {
    text: `${Math.max(1, Math.floor(abs / size))}${label} ${
      diff < 0 ? '지남' : '남음'
    }`,
    overdue: diff < 0,
  };
}

export const REPEAT_LABEL: Record<string, string> = {
  day: '매일',
  week: '매주',
  month: '매월',
  year: '매년',
};

export function formatDue(dueDate: number, timeFormat: '12' | '24' = '12') {
  const d = new Date(dueDate);
  const week = '일월화수목금토'[d.getDay()];
  const endOfDay = d.getHours() === 23 && d.getMinutes() === 59;
  const date = `${d.getMonth() + 1}월 ${d.getDate()}일 (${week})`;
  if (endOfDay) return date;
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  if (timeFormat === '24') return `${date} ${String(h).padStart(2, '0')}:${m}`;
  return `${date} ${h < 12 ? '오전' : '오후'} ${
    h % 12 === 0 ? 12 : h % 12
  }:${m}`;
}
