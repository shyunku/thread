import { createContext, useContext } from "react";

// The selected task of the main screen (#102), one at a time. TodoContent provides it; the list
// rows set it and the right panel (phase F) reads it.
// - selectedTaskId: the task id or null.
// - setSelectedTaskId(id | null).
// - openTask(id): 열기 (Enter, the task menu): selects the task; the panel shows its detail.
export const TaskSelectionContext = createContext({
  selectedTaskId: null,
  setSelectedTaskId: () => {},
  openTask: () => {},
});

export function useTaskSelection() {
  return useContext(TaskSelectionContext);
}
