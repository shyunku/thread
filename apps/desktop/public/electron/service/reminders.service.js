// Due reminders on the PC (#91): Windows notifications while the app runs (the window may be
// closed to the tray). Planned from the lists the vault publishes while it is open
// (packages/e2ee model/reminders); one timer waits for the next one.
// - Locked vault: the titles are dropped from memory and the planned reminders come without
//   content; tasks changed elsewhere meanwhile are known again after the next unlock.
// - Secret tasks are planned without a title, so they never show content.
// - A click opens the window on that task (only while unlocked).
const { planReminders, reminderText } = require("@thread/e2ee/src/model/reminders");

// The timer re-checks at least hourly (sleep, clock changes); a reminder found late after a
// sleep still shows within this window, older ones are skipped.
const MAX_WAIT_MS = 60 * 60 * 1000;
const LATE_MS = 15 * 60 * 1000;
const LIMIT = 500;

class RemindersService {
  constructor({ electron = () => require("electron"), settings = () => require("../modules/appSettings").getSettings().reminders, now = () => Date.now() } = {}) {
    this.electron = electron;
    this.settings = settings;
    this.now = now;
    this.plan = [];
    this.lists = null;
    this.locked = true;
    this.timeFormat = "12";
    this.timer = null;
    this.shown = new Set(); // Electron drops notifications that are not referenced.
  }
  inject(group) {
    this.group = group;
  }
  // The vault published its lists (opened, synced or edited).
  update(lists) {
    this.lists = lists;
    this.locked = false;
    this.replan();
  }
  // The vault locked (screen lock, suspend, 잠그기) or the account changed.
  lock() {
    this.lists = null;
    this.locked = true;
    this.plan = this.plan.map((item) => ({ ...item, title: null }));
    this.arm();
  }
  setTimeFormat(value) {
    if (value === "12" || value === "24") this.timeFormat = value;
  }
  settingsChanged() {
    if (this.lists) return this.replan();
    const s = this.settings();
    // Locked: the plan cannot be rebuilt; it is kept only while the choice still allows it.
    this.plan = !s?.enabled ? [] : this.plan.filter((item) => (item.kind === "before" ? s.before && item.minutes === s.minutes : s.due));
    this.arm();
  }
  replan() {
    this.plan = planReminders(this.lists, this.settings(), { now: this.now(), limit: LIMIT });
    this.arm();
  }
  arm() {
    clearTimeout(this.timer);
    this.timer = null;
    const next = this.plan[0];
    if (!next) return;
    this.timer = setTimeout(() => this.tick(), Math.max(0, Math.min(next.at - this.now(), MAX_WAIT_MS)));
    this.timer.unref?.();
  }
  tick() {
    const now = this.now();
    while (this.plan.length && this.plan[0].at <= now) {
      const item = this.plan.shift();
      if (now - item.at <= LATE_MS) this.show(item);
    }
    this.arm();
  }
  show(item) {
    const { Notification } = this.electron();
    if (!Notification?.isSupported?.()) return;
    const text = reminderText(item, { timeFormat: this.timeFormat, hidden: this.locked });
    const notification = new Notification({ title: text.title, body: text.body });
    const done = () => this.shown.delete(notification);
    this.shown.add(notification);
    notification.on("click", () => {
      done();
      this.open(item.tid);
    });
    notification.on("close", done);
    notification.show();
  }
  open(tid) {
    const window = this.group?.windowService?.mainWindow;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (!this.locked) window.webContents.send("reminder/open", null, { success: true, data: { tid } });
  }
}

module.exports = { RemindersService, MAX_WAIT_MS, LATE_MS };
