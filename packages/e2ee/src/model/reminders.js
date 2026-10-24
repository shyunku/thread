// Due reminders (#91), shared by the PC and the phone. From the lists (entityLists) and the
// reminder settings this plans the notifications to schedule, soonest first:
// - "before": `minutes` before the due time; "due": at the due time. Both can be on.
// - Only open tasks with a chosen time: a due without one is stored as 23:59 (하루 끝) and gets none.
// - A task in any secret category is planned without its title (`title: null`), so no content
//   is shown or stored for it.
// - Past times are dropped; `limit` keeps the soonest (iOS allows 64 pending notifications).
const DEFAULT_REMINDERS = Object.freeze({ enabled: true, before: true, minutes: 10, due: false });
const MINUTE_CHOICES = [5, 10, 15, 30, 60];

function normalReminders(value) {
  const v = value && typeof value === "object" ? value : {};
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_REMINDERS.enabled,
    before: typeof v.before === "boolean" ? v.before : DEFAULT_REMINDERS.before,
    minutes: MINUTE_CHOICES.includes(v.minutes) ? v.minutes : DEFAULT_REMINDERS.minutes,
    due: typeof v.due === "boolean" ? v.due : DEFAULT_REMINDERS.due,
  };
}

const hasChosenTime = (ms) => {
  const d = new Date(ms);
  return !(d.getHours() === 23 && d.getMinutes() === 59);
};

function planReminders(lists, settings, { now = Date.now(), limit = Infinity } = {}) {
  const s = normalReminders(settings);
  if (!s.enabled || (!s.before && !s.due)) return [];
  const secretCats = new Set((lists?.categories ?? []).filter((c) => c.secret).map((c) => c.cid));
  const secretTasks = new Set((lists?.relations ?? []).filter((r) => secretCats.has(r.cid)).map((r) => r.tid));
  const out = [];
  for (const task of lists?.tasks ?? []) {
    const due = Number(task.due_date) || 0;
    if (task.done || due <= 0 || !hasChosenTime(due)) continue;
    const title = secretTasks.has(task.tid) ? null : String(task.title ?? "");
    if (s.before) {
      const at = due - s.minutes * 60000;
      if (at > now) out.push({ id: `${task.tid}:before`, tid: task.tid, kind: "before", at, due, minutes: s.minutes, title });
    }
    if (s.due && due > now) out.push({ id: `${task.tid}:due`, tid: task.tid, kind: "due", at: due, due, minutes: 0, title });
  }
  out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return Number.isFinite(limit) ? out.slice(0, Math.max(0, limit)) : out;
}

// The notification text. `hidden`: no content (a secret task, or the PC vault is locked).
// timeFormat "12" reads 오후 3:00, "24" reads 15:00.
function clock(ms, timeFormat) {
  const d = new Date(ms), h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
  if (timeFormat === "24") return `${String(h).padStart(2, "0")}:${m}`;
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${m}`;
}
function reminderText(item, { timeFormat = "12", hidden = false } = {}) {
  const time = clock(item.due, timeFormat);
  if (hidden || item.title == null)
    return { title: "Thread", body: item.kind === "before" ? `할 일 1개의 기한이 ${item.minutes}분 남았어요` : "할 일 1개의 기한이에요" };
  return { title: item.title || "제목 없는 할 일", body: item.kind === "before" ? `${item.minutes}분 뒤 기한 · ${time}` : `지금 기한이에요 · ${time}` };
}

module.exports = { DEFAULT_REMINDERS, MINUTE_CHOICES, normalReminders, planReminders, hasChosenTime, reminderText };
