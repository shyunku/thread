import { combineReducers } from "@reduxjs/toolkit";
import persistReducer from "redux-persist/lib/persistReducer";
import { REHYDRATE } from "redux-persist/lib/constants";
import prefsReducer, { migratePrefs, prefsFromParams, prefsSelector, setPrefs } from "./prefsSlice";

const fresh = () => prefsReducer(undefined, { type: "init" });

test("time display prefs default to 묶음 맞춤, 보통 and remaining time shown, and reject unknown values", () => {
  const initial = fresh();
  expect(initial).toMatchObject({ remainFormat: "normal", dueFormat: "group", showRemain: true });
  expect(initial).not.toHaveProperty("timeDisplay");
  const next = prefsReducer(initial, setPrefs({ showRemain: false, remainFormat: "all", dueFormat: "full" }));
  expect(next).toMatchObject({ showRemain: false, remainFormat: "all", dueFormat: "full" });
  const kept = prefsReducer(next, setPrefs({ showRemain: "yes", remainFormat: "seconds", dueFormat: "auto2" }));
  expect(kept).toMatchObject({ showRemain: false, remainFormat: "all", dueFormat: "full" });
  expect(prefsReducer(kept, setPrefs({ dueFormat: "group" })).dueFormat).toBe("group");
  // Stores saved before #101 have no such keys; the selector fills the defaults.
  expect(prefsSelector({ prefs: { timeFormat: "24" } })).toMatchObject({ timeFormat: "24", showRemain: true, remainFormat: "normal", dueFormat: "group" });
});

test("list view options have defaults and accept only their own values", () => {
  const initial = fresh();
  expect(initial).toMatchObject({ group: "date", noneTop: false, sort: "due", density: "normal", hideDone: false, groupClosed: { done: true } });
  const next = prefsReducer(initial, setPrefs({ group: "none", noneTop: true, sort: "created", density: "compact", hideDone: true }));
  expect(next).toMatchObject({ group: "none", noneTop: true, sort: "created", density: "compact", hideDone: true });
  const kept = prefsReducer(next, setPrefs({ group: "category", noneTop: 1, sort: "remain", density: "tight", hideDone: "true" }));
  expect(kept).toMatchObject({ group: "none", noneTop: true, sort: "created", density: "compact", hideDone: true });
});

test("group fold states merge by id and ignore bad ids and values", () => {
  let state = prefsReducer(fresh(), setPrefs({ groupClosed: { today: true, later: false } }));
  expect(state.groupClosed).toEqual({ done: true, today: true, later: false });
  state = prefsReducer(state, setPrefs({ groupClosed: { today: false, "Bad Id": true, week: "yes" } }));
  expect(state.groupClosed).toEqual({ done: true, today: false, later: false });
  state = prefsReducer(state, setPrefs({ groupClosed: ["today"] }));
  expect(state.groupClosed).toEqual({ done: true, today: false, later: false });
  // Bounded so a broken caller cannot grow the persisted store without limit.
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`g${i}`, true]));
  expect(Object.keys(prefsReducer(state, setPrefs({ groupClosed: many })).groupClosed)).toHaveLength(32);
});

test("the old list keys (listTodoOpen / listDoneOpen) are gone from the state and patches", () => {
  const state = prefsReducer(fresh(), setPrefs({ listDoneOpen: true, listTodoOpen: false }));
  expect(state).not.toHaveProperty("listDoneOpen");
  expect(state).not.toHaveProperty("listTodoOpen");
  expect(state.groupClosed).toEqual({ done: true });
});

test("the old 기한 choice still arriving in a patch turns the remaining time off", () => {
  expect(prefsReducer(fresh(), setPrefs({ timeDisplay: "due" }))).toMatchObject({ showRemain: false });
  expect(prefsReducer(fresh(), setPrefs({ timeDisplay: "due", showRemain: true }))).toMatchObject({ showRemain: true });
  expect(prefsReducer(fresh(), setPrefs({ timeDisplay: "due" }))).not.toHaveProperty("timeDisplay");
});

describe("prefs saved before #102", () => {
  const old = (extra) => ({ startView: "calendar", weekStart: 1, timeFormat: "24", timeDisplay: "remain", remainFormat: "detailed", dueFormat: "auto", listTodoOpen: true, listDoneOpen: false, ...extra });

  test("남은 시간 mode keeps the remaining time and moves the untouched 자동 to 묶음 맞춤", () => {
    const prefs = migratePrefs(old());
    expect(prefs).toMatchObject({ startView: "calendar", weekStart: 1, timeFormat: "24", showRemain: true, remainFormat: "detailed", dueFormat: "group", groupClosed: { done: true } });
    expect(prefs).not.toHaveProperty("timeDisplay");
    // A due format chosen on purpose stays.
    expect(migratePrefs(old({ dueFormat: "exact" })).dueFormat).toBe("exact");
  });

  test("기한 mode turns the remaining time off and keeps the chosen due format, even 자동", () => {
    expect(migratePrefs(old({ timeDisplay: "due" }))).toMatchObject({ showRemain: false, dueFormat: "auto" });
    expect(migratePrefs(old({ timeDisplay: "due", dueFormat: "full" }))).toMatchObject({ showRemain: false, dueFormat: "full" });
  });

  test("an open 완료됨 group stays open", () => {
    expect(migratePrefs(old({ listDoneOpen: true })).groupClosed).toEqual({ done: false });
    expect(migratePrefs(old({ listDoneOpen: false })).groupClosed).toEqual({ done: true });
    expect(migratePrefs(old({ listDoneOpen: true }))).not.toHaveProperty("listDoneOpen");
    expect(migratePrefs(old({ listDoneOpen: true }))).not.toHaveProperty("listTodoOpen");
  });

  test("already migrated prefs are kept as they are", () => {
    const now = migratePrefs({ ...old(), showRemain: true, dueFormat: "auto", groupClosed: { done: false, today: true } });
    expect(now).toMatchObject({ showRemain: true, dueFormat: "auto", groupClosed: { done: false, today: true } });
  });

  test("garbage falls back to the defaults", () => {
    expect(migratePrefs(null)).toEqual(fresh());
    expect(migratePrefs("x")).toEqual(fresh());
    expect(migratePrefs({ weekStart: 3, group: 1, groupClosed: null })).toEqual(fresh());
  });

  test("redux-persist rehydration migrates the restored prefs", () => {
    const root = persistReducer({ key: "root", storage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }, combineReducers({ prefs: prefsReducer }));
    const start = root(undefined, { type: "init" });
    const restored = root(start, { type: REHYDRATE, key: "root", payload: { prefs: old({ timeDisplay: "due", listDoneOpen: true }) } });
    expect(restored.prefs).toMatchObject({ showRemain: false, dueFormat: "auto", groupClosed: { done: false }, weekStart: 1 });
    expect(restored.prefs).not.toHaveProperty("timeDisplay");
    // Other stores' rehydration does not touch prefs.
    expect(root(restored, { type: REHYDRATE, key: "other", payload: { prefs: {} } }).prefs).toBe(restored.prefs);
  });
});

test("the selector returns the same object until prefs change", () => {
  const state = { prefs: fresh() };
  expect(prefsSelector(state)).toBe(prefsSelector({ ...state }));
  expect(prefsSelector({ prefs: { ...state.prefs, density: "compact" } }).density).toBe("compact");
});

test("dev preview URL params become typed prefs; bad values are still ignored", () => {
  const params = new URLSearchParams(`showRemain=false&hideDone=true&noneTop=true&weekStart=1&timeFormat=24&groupClosed=${encodeURIComponent(JSON.stringify({ today: true, done: false }))}&dueFormat=auto&tab=general`);
  const state = prefsReducer(fresh(), setPrefs(prefsFromParams(params)));
  expect(state).toMatchObject({ showRemain: false, hideDone: true, noneTop: true, weekStart: 1, timeFormat: "24", dueFormat: "auto", groupClosed: { today: true, done: false } });
  expect(state).not.toHaveProperty("tab");
  const bad = prefsReducer(fresh(), setPrefs(prefsFromParams(new URLSearchParams("showRemain=no&weekStart=7&groupClosed={bad&timeDisplay=due"))));
  expect(bad).toEqual({ ...fresh(), showRemain: false });
});

test("panel width: null follows the layout; only whole px in 320–480 are kept; null resets", () => {
  expect(fresh().panelWidth).toBeNull();
  let state = prefsReducer(fresh(), setPrefs({ panelWidth: 412.4 }));
  expect(state.panelWidth).toBe(412);
  for (const bad of [319, 481, NaN, Infinity, "400", true, {}, []]) {
    expect(prefsReducer(state, setPrefs({ panelWidth: bad })).panelWidth).toBe(412);
  }
  // A patch without the key leaves it; an explicit null is the double-click reset.
  expect(prefsReducer(state, setPrefs({ density: "compact" })).panelWidth).toBe(412);
  expect(prefsReducer(state, setPrefs({ panelWidth: undefined })).panelWidth).toBe(412);
  state = prefsReducer(state, setPrefs({ panelWidth: null }));
  expect(state.panelWidth).toBeNull();
  expect(prefsReducer(state, setPrefs({ panelWidth: 320 })).panelWidth).toBe(320);
  expect(prefsReducer(state, setPrefs({ panelWidth: 480 })).panelWidth).toBe(480);
});

test("panel width from saved prefs: older stores get the layout default, bad values are dropped", () => {
  expect(migratePrefs({ timeFormat: "24" }).panelWidth).toBeNull();
  expect(migratePrefs({ panelWidth: 440 }).panelWidth).toBe(440);
  expect(migratePrefs({ panelWidth: 900 }).panelWidth).toBeNull();
  expect(migratePrefs({ panelWidth: "440" }).panelWidth).toBeNull();
  expect(prefsSelector({ prefs: { showRemain: true } }).panelWidth).toBeNull();
  expect(prefsReducer(fresh(), setPrefs(prefsFromParams(new URLSearchParams("panelWidth=440")))).panelWidth).toBe(440);
  expect(prefsReducer(fresh(), setPrefs(prefsFromParams(new URLSearchParams("panelWidth=wide")))).panelWidth).toBeNull();
});
