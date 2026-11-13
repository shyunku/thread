import { createContext, useContext } from "react";

// Local midnight of a day (ms), the form the picked day is kept in.
export const startOfDay = (value) => new Date(value).setHours(0, 0, 0, 0);

// The picked day of the main screen (#102), shared by the calendar view and the right panel's
// calendar tab (and its 선택한 날 list). TodoContent provides it; it starts on today.
// - pickedDay: ms at local midnight.
// - setPickedDay(day): a Date or ms of any time that day.
// - shownDays / setShownDays(n): how many days from the picked day the timeline shows (0 when
//   it is not on screen); the panel's month marks them (#110).
export const PickedDayContext = createContext({
  pickedDay: startOfDay(Date.now()),
  setPickedDay: () => {},
  shownDays: 0,
  setShownDays: () => {},
});

export function usePickedDay() {
  return useContext(PickedDayContext);
}
