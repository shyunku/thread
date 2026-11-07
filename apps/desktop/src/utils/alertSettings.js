import { useEffect, useState } from "react";
import IpcSender from "./IpcSender";
import { DEFAULT_ALERT_SETTINGS, normalAlertSettings } from "./taskPeriod";

// The reminder settings (설정 > 알림, main's app-settings.json) for the task alert menu and the
// detail's bells (#109). Read from main when a user mounts; the settings page passes on what it
// saves (noteAlertSettings), so open menus follow it.
let cache = null;
const listeners = new Set();

export function noteAlertSettings(reminders) {
  if (!reminders || typeof reminders !== "object") return;
  cache = normalAlertSettings(reminders);
  for (const listener of listeners) listener(cache);
}

function load() {
  try {
    IpcSender.appSettings?.get?.(({ success, data } = {}) => {
      if (success) noteAlertSettings(data?.reminders);
    });
  } catch {}
}

export function useAlertSettings() {
  const [value, setValue] = useState(() => cache ?? DEFAULT_ALERT_SETTINGS);
  useEffect(() => {
    listeners.add(setValue);
    load();
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}
