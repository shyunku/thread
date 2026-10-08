import prefsReducer, { prefsSelector, setPrefs } from "./prefsSlice";

test("time display prefs default to remaining time, 보통 and 자동, and reject unknown values", () => {
  const initial = prefsReducer(undefined, { type: "init" });
  expect(initial).toMatchObject({ timeDisplay: "remain", remainFormat: "normal", dueFormat: "auto" });
  const next = prefsReducer(initial, setPrefs({ timeDisplay: "due", remainFormat: "all", dueFormat: "full" }));
  expect(next).toMatchObject({ timeDisplay: "due", remainFormat: "all", dueFormat: "full" });
  const kept = prefsReducer(next, setPrefs({ timeDisplay: "end", remainFormat: "seconds", dueFormat: "auto2" }));
  expect(kept).toMatchObject({ timeDisplay: "due", remainFormat: "all", dueFormat: "full" });
  // Stores saved before #101 have no such keys; the selector fills the defaults.
  expect(prefsSelector({ prefs: { timeFormat: "24" } })).toMatchObject({ timeFormat: "24", timeDisplay: "remain", remainFormat: "normal", dueFormat: "auto" });
});
