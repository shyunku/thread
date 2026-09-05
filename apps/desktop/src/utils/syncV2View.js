import Task from "../objects/Task";
import Category from "../objects/Category";
import Subtask from "../objects/Subtask";

// Reuse the existing UI models, while replacing the whole confirmed+optimistic
// view only after the main-process SQLite transaction has committed.
export function fromSyncV2View(view) {
  const taskMap = Object.create(null),
    categories = Object.create(null);
  for (const row of view.categories)
    categories[row.cid] = Category.fromEntity(row);
  for (const row of view.tasks) taskMap[row.tid] = Task.fromEntity(row);
  for (const row of view.tasks) {
    const task = taskMap[row.tid],
      next = taskMap[row.next];
    task.next = next || null;
    if (next) next.prev = task;
  }
  for (const row of view.subtasks) {
    const task = taskMap[row.tid];
    if (!task) throw Error("MISSING_PARENT");
    task.addSubtask(Subtask.fromEntity(row));
  }
  for (const row of view.relations) {
    const task = taskMap[row.tid],
      category = categories[row.cid];
    if (!task || !category) throw Error("MISSING_CATEGORY");
    task.addCategory(category);
  }
  return { taskMap, categories };
}
