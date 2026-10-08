import { useSyncExternalStore } from "react";

// One shared 1-second clock for every task row (#101). A component re-renders only
// when the value it selects from the current time changes, so rows whose text stays
// the same cost one selector call per tick.
let now = Date.now();
let timer = null;
const listeners = new Set();

function tick() {
  now = Date.now();
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  if (timer == null) {
    now = Date.now();
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// While nothing is subscribed the clock is idle, so read the time afresh.
function currentTime() {
  if (timer == null) now = Date.now();
  return now;
}

// `select` maps the current time (ms) to a primitive, e.g. the text a row shows.
export default function useClock(select) {
  return useSyncExternalStore(subscribe, () => select(currentTime()));
}
