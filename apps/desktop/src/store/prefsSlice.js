const { createSlice } = require("@reduxjs/toolkit");

// Display preferences (persisted with the rest of the root store).
export const START_VIEWS = ["list", "calendar", "timeline"];
const initialState = Object.freeze({
  startView: "list",
  weekStart: 0, // 0 = Sunday, 1 = Monday
  timeFormat: "12", // "12" | "24"
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
    },
  },
});

export const { setPrefs } = prefsSlice.actions;
export const prefsSelector = (state) => ({ ...initialState, ...(state.prefs || {}) });
export default prefsSlice.reducer;
