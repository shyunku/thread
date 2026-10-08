const { createSlice } = require("@reduxjs/toolkit");
const { DUE_FORMATS, REMAIN_FORMATS, TIME_DISPLAYS } = require("utils/timeDisplay");

// Display preferences (persisted with the rest of the root store).
export const START_VIEWS = ["list", "calendar", "timeline"];
const initialState = Object.freeze({
  startView: "list",
  weekStart: 0, // 0 = Sunday, 1 = Monday
  timeFormat: "12", // "12" | "24"
  // 시간 표시 on task lines (#101): remaining time or due date, and how detailed.
  timeDisplay: "remain", // "remain" | "due"
  remainFormat: "normal", // "simple" | "normal" | "detailed" | "all"
  dueFormat: "auto", // "simple" | "auto" | "exact" | "full"
  // List view groups ("해야할 일" / "완료됨"), remembered on this device.
  listTodoOpen: true,
  listDoneOpen: false,
});

const prefsSlice = createSlice({
  name: "prefs",
  initialState,
  reducers: {
    setPrefs: (state, action) => {
      const patch = action.payload || {};
      if (START_VIEWS.includes(patch.startView)) state.startView = patch.startView;
      if (patch.weekStart === 0 || patch.weekStart === 1) state.weekStart = patch.weekStart;
      if (patch.timeFormat === "12" || patch.timeFormat === "24") state.timeFormat = patch.timeFormat;
      if (TIME_DISPLAYS.includes(patch.timeDisplay)) state.timeDisplay = patch.timeDisplay;
      if (REMAIN_FORMATS.includes(patch.remainFormat)) state.remainFormat = patch.remainFormat;
      if (DUE_FORMATS.includes(patch.dueFormat)) state.dueFormat = patch.dueFormat;
      if (typeof patch.listTodoOpen === "boolean") state.listTodoOpen = patch.listTodoOpen;
      if (typeof patch.listDoneOpen === "boolean") state.listDoneOpen = patch.listDoneOpen;
    },
  },
});

export const { setPrefs } = prefsSlice.actions;
export const prefsSelector = (state) => ({ ...initialState, ...(state.prefs || {}) });
export default prefsSlice.reducer;
