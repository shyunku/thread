const { createSlice } = require("@reduxjs/toolkit");
const { REHYDRATE } = require("redux-persist/lib/constants");
const { DUE_FORMATS, REMAIN_FORMATS, TIME_DISPLAYS } = require("utils/timeDisplay");

// Display preferences (persisted with the rest of the root store, this device only).
export const START_VIEWS = ["list", "calendar", "timeline"];
export const LIST_GROUPS = ["date", "none"]; // 날짜별 / 묶지 않기 (기한 순)
export const LIST_SORTS = ["due", "created"]; // inside a group: 기한 순 / 생성일 순 (newest first)
export const LIST_DENSITIES = ["normal", "compact"]; // 보통 (두 줄) / 촘촘 (한 줄)
// Right panel width the splitter drag leaves (#102), in px; null = the layout's default.
export const PANEL_WIDTH_MIN = 320;
export const PANEL_WIDTH_MAX = 480;
const GROUP_ID = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_GROUP_STATES = 32;

const initialState = Object.freeze({
  startView: "list",
  weekStart: 0, // 0 = Sunday, 1 = Monday
  timeFormat: "12", // "12" | "24"
  // 시간 표시 (#101, #102): the task line shows the due on top and, optionally, the remaining time below.
  remainFormat: "normal", // "simple" | "normal" | "detailed" | "all"
  dueFormat: "group", // "group" (묶음 맞춤) | "simple" | "auto" | "exact" | "full"
  showRemain: true, // 남은 시간 보이기 (settings and the list's view menu)
  // List view options (#102).
  group: "date",
  noneTop: false, // 기한 없음 group on top instead of at the bottom
  sort: "due",
  density: "normal",
  hideDone: false, // 완료한 할 일 숨기기
  groupClosed: Object.freeze({ done: true }), // folded groups by id (utils/dateGroups DATE_GROUP_IDS)
  panelWidth: null, // dragged right panel width (PANEL_WIDTH_MIN–MAX); null follows the layout
});

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Applies the valid keys of `patch` to `state` (an immer draft or a plain copy); others are ignored.
function applyPatch(state, patch) {
  if (START_VIEWS.includes(patch.startView)) state.startView = patch.startView;
  if (patch.weekStart === 0 || patch.weekStart === 1) state.weekStart = patch.weekStart;
  if (patch.timeFormat === "12" || patch.timeFormat === "24") state.timeFormat = patch.timeFormat;
  if (REMAIN_FORMATS.includes(patch.remainFormat)) state.remainFormat = patch.remainFormat;
  if (DUE_FORMATS.includes(patch.dueFormat)) state.dueFormat = patch.dueFormat;
  if (typeof patch.showRemain === "boolean") state.showRemain = patch.showRemain;
  // The pre-#102 choice still arrives from old dev preview links: 기한 = no remaining time.
  else if (TIME_DISPLAYS.includes(patch.timeDisplay)) state.showRemain = patch.timeDisplay !== "due";
  if (LIST_GROUPS.includes(patch.group)) state.group = patch.group;
  if (typeof patch.noneTop === "boolean") state.noneTop = patch.noneTop;
  if (LIST_SORTS.includes(patch.sort)) state.sort = patch.sort;
  if (LIST_DENSITIES.includes(patch.density)) state.density = patch.density;
  if (typeof patch.hideDone === "boolean") state.hideDone = patch.hideDone;
  // null (double-click on the splitter) goes back to the layout's default.
  if (patch.panelWidth === null) state.panelWidth = null;
  else if (Number.isFinite(patch.panelWidth) && patch.panelWidth >= PANEL_WIDTH_MIN && patch.panelWidth <= PANEL_WIDTH_MAX)
    state.panelWidth = Math.round(patch.panelWidth);
  // groupClosed merges: setPrefs({ groupClosed: { today: true } }) folds 오늘 and keeps the rest.
  if (isPlainObject(patch.groupClosed)) {
    const next = { ...state.groupClosed };
    for (const [id, closed] of Object.entries(patch.groupClosed)) {
      if (!GROUP_ID.test(id) || typeof closed !== "boolean") continue;
      if (!Object.prototype.hasOwnProperty.call(next, id) && Object.keys(next).length >= MAX_GROUP_STATES) continue;
      next[id] = closed;
    }
    state.groupClosed = next;
  }
}

// Turns any saved prefs object (also from before #102) into the current shape.
export function migratePrefs(saved) {
  const state = { ...initialState, groupClosed: { ...initialState.groupClosed } };
  if (!isPlainObject(saved)) return state;
  const patch = { ...saved };
  if (typeof saved.showRemain !== "boolean") {
    // Saved before #102. The 기한 choice becomes "remaining time off"; the old default 자동
    // was only visible with 기한, so without it the new default 묶음 맞춤 applies.
    patch.showRemain = saved.timeDisplay !== "due";
    if (saved.timeDisplay !== "due" && saved.dueFormat === "auto") delete patch.dueFormat;
  }
  // Before #102 the list had only 해야할 일 / 완료됨: the saved 완료됨 fold (listDoneOpen) carries
  // over to the 완료됨 group until groups have their own states.
  if (!isPlainObject(saved.groupClosed)) {
    delete patch.groupClosed;
    if (typeof saved.listDoneOpen === "boolean") patch.groupClosed = { done: !saved.listDoneOpen };
  }
  applyPatch(state, patch);
  return state;
}

const prefsSlice = createSlice({
  name: "prefs",
  initialState,
  reducers: {
    setPrefs: (state, action) => applyPatch(state, action.payload || {}),
  },
  extraReducers: (builder) => {
    // Migrate what redux-persist restores (store key "root", see rootReducer.js).
    builder.addCase(REHYDRATE, (state, action) =>
      action.key === "root" && isPlainObject(action.payload?.prefs) ? migratePrefs(action.payload.prefs) : state);
  },
});

export const { setPrefs } = prefsSlice.actions;

// Dev previews take prefs from URL text, e.g. ?showRemain=false&weekStart=1&groupClosed={"today":true}.
// This only converts the text to the types setPrefs expects; setPrefs still validates every value.
export function prefsFromParams(params) {
  const patch = {};
  for (const [key, value] of params) {
    if (value === "true" || value === "false") patch[key] = value === "true";
    else if (key === "weekStart" || key === "panelWidth") patch[key] = Number(value);
    else if (key === "groupClosed") {
      try { patch[key] = JSON.parse(value); } catch { /* ignored like any other bad value */ }
    } else patch[key] = value;
  }
  return patch;
}

// Stores that were not rehydrated through the reducer (tests, previews) may still hold old
// shapes, so the selector migrates too. Cached per prefs object to keep the same reference.
let lastSaved, lastPrefs;
export const prefsSelector = (state) => {
  const saved = state?.prefs;
  if (lastPrefs === undefined || saved !== lastSaved) {
    lastSaved = saved;
    lastPrefs = migratePrefs(saved);
  }
  return lastPrefs;
};
export default prefsSlice.reducer;
