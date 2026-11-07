// Due reminders (#91), shared by the PC and the phone. From the lists (entityLists) and the
// reminder settings this plans the notifications to schedule, soonest first:
// - "before": `minutes` before the due time; "due": at the due time. Both can be on.
// - Only open tasks with a chosen time: a due without one is stored as 23:59 (하루 끝) and gets none.
// - A task in any secret category is planned without its title (`title: null`), so no content
//   is shown or stored for it.
// - Past times are dropped; `limit` keeps the soonest (iOS allows 64 pending notifications).
// Periods (#109, PC 2.6.0) are opt-in ({ periods: true }): start alerts ("start-before",
// "start") and the per-task overrides (alert_start / alert_end). Without it the plan is the
// one before #109, so the phone keeps ringing by its global settings until its own update.
const DEFAULT_REMINDERS = Object.freeze({ enabled: true, before: true, minutes: 10, due: false });
// The start group (#109): N minutes before the start, and at the start.
const DEFAULT_START_REMINDERS = Object.freeze({ startBefore: true, startMinutes: 10, startAt: false });
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
// The PC's settings (#109): the end keys above plus the start group.
function normalPeriodReminders(value) {
  const v = value && typeof value === "object" ? value : {}, d = DEFAULT_START_REMINDERS;
  return {
    ...normalReminders(v),
    startBefore: typeof v.startBefore === "boolean" ? v.startBefore : d.startBefore,
    startMinutes: MINUTE_CHOICES.includes(v.startMinutes) ? v.startMinutes : d.startMinutes,
    startAt: typeof v.startAt === "boolean" ? v.startAt : d.startAt,
  };
}

const hasChosenTime = (ms) => {
  const d = new Date(ms);
  return !(d.getHours() === 23 && d.getMinutes() === 59);
};
// A start without a chosen time is stored at 00:00 (하루 시작) and gets no alert.
const hasStartTime = (ms) => {
  const d = new Date(ms);
  return !(d.getHours() === 0 && d.getMinutes() === 0);
};
// The period start of a task row (ms), or null. start_offset counts only with a due date and
// when it leaves the start strictly before the due.
function taskStart(task) {
  const due = Number(task?.due_date) || 0, offset = task?.start_offset;
  return due > 0 && Number.isSafeInteger(offset) && offset > 0 && offset < due ? due - offset : null;
}
// A per-task override: "on", "off", or null (follow the settings).
const alertOverride = (value) => (value === "on" || value === "off" ? value : null);

// The alerts one side of a task rings, as [{ kind, minutes }] (minutes 0: at the time), from
// the normalized PC settings and the task's override for that side:
// - follow: the side's enabled alerts (none while reminders are off);
// - "off": none;
// - "on": the side's enabled alerts, or once N minutes before when the settings have none on.
function sideAlerts(side, s, override) {
  const start = side === "start";
  const before = start ? s.startBefore : s.before, at = start ? s.startAt : s.due;
  const minutes = start ? s.startMinutes : s.minutes;
  const kinds = start ? ["start-before", "start"] : ["before", "due"];
  const list = s.enabled ? [before && { kind: kinds[0], minutes }, at && { kind: kinds[1], minutes: 0 }].filter(Boolean) : [];
  if (override === "off") return [];
  if (override === "on" && !list.length) return [{ kind: kinds[0], minutes }];
  return list;
}

function planReminders(lists, settings, { now = Date.now(), limit = Infinity, periods = false } = {}) {
  const s = periods ? normalPeriodReminders(settings) : normalReminders(settings);
  if (!periods && (!s.enabled || (!s.before && !s.due))) return [];
  const secretCats = new Set((lists?.categories ?? []).filter((c) => c.secret).map((c) => c.cid));
  const secretTasks = new Set((lists?.relations ?? []).filter((r) => secretCats.has(r.cid)).map((r) => r.tid));
  const out = [];
  const push = (task, title, kind, at, minutes, extra) => {
    if (at > now) out.push({ id: `${task.tid}:${kind}`, tid: task.tid, kind, at, due: Number(task.due_date), minutes, title, ...extra });
  };
  for (const task of lists?.tasks ?? []) {
    const due = Number(task.due_date) || 0;
    if (task.done || due <= 0) continue;
    const title = secretTasks.has(task.tid) ? null : String(task.title ?? "");
    if (!periods) {
      if (!hasChosenTime(due)) continue;
      if (s.before) push(task, title, "before", due - s.minutes * 60000, s.minutes);
      if (s.due) push(task, title, "due", due, 0);
      continue;
    }
    // `override` rides along so a locked PC can keep a forced alert when the settings change.
    if (hasChosenTime(due)) {
      const override = alertOverride(task.alert_end);
      for (const a of sideAlerts("end", s, override)) push(task, title, a.kind, due - a.minutes * 60000, a.minutes, { override });
    }
    const start = taskStart(task);
    if (start !== null && hasStartTime(start)) {
      const override = alertOverride(task.alert_start);
      for (const a of sideAlerts("start", s, override))
        push(task, title, a.kind, start - a.minutes * 60000, a.minutes, { start, override });
    }
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
const span = (minutes) => (minutes === 60 ? "1시간" : `${minutes}분`);
// The mock's wording (#91): "오후 3:00까지 · 10분 남음" before, "지금 기한이에요 · 오후 3:00" at the
// time. Start alerts (#109): "오후 3:00부터 · 10분 뒤 시작", "지금 시작해요 · 오후 3:00". Without
// content the title says it all; a locked PC adds how to see it.
function reminderText(item, { timeFormat = "12", hidden = false } = {}) {
  const start = item.kind === "start-before" || item.kind === "start";
  const time = clock(start ? item.start : item.due, timeFormat), before = item.kind === "before" || item.kind === "start-before";
  if (hidden || item.title == null) {
    const title = start
      ? before ? `할 일 1개가 ${span(item.minutes)} 뒤 시작해요` : "할 일 1개가 지금 시작해요"
      : before ? `할 일 1개의 기한이 ${span(item.minutes)} 남았어요` : "할 일 1개의 기한이에요";
    return { title, body: hidden ? "앱 잠금을 풀면 볼 수 있어요" : "" };
  }
  const body = start
    ? before ? `${time}부터 · ${span(item.minutes)} 뒤 시작` : `지금 시작해요 · ${time}`
    : before ? `${time}까지 · ${span(item.minutes)} 남음` : `지금 기한이에요 · ${time}`;
  return { title: item.title || "제목 없는 할 일", body };
}

module.exports = {
  DEFAULT_REMINDERS, DEFAULT_START_REMINDERS, MINUTE_CHOICES, normalReminders, normalPeriodReminders, planReminders,
  hasChosenTime, hasStartTime, taskStart, alertOverride, sideAlerts, reminderText,
};
