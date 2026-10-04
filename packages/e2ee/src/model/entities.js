const { v4: randomUUID } = require("../uuid");
const mutationTopics = new Set([
  "task/addTask",
  "task/deleteTask",
  "task/updateTaskOrder",
  "task/updateTaskTitle",
  "task/updateTaskDueDate",
  "task/updateTaskMemo",
  "task/updateTaskDone",
  "task/addTaskCategory",
  "task/deleteTaskCategory",
  "task/updateTaskRepeatPeriod",
  "task/createSubtask",
  "task/deleteSubtask",
  "task/updateSubtaskTitle",
  "task/updateSubtaskDueDate",
  "task/updateSubtaskDone",
  "category/createCategory",
  "category/deleteCategory",
  "category/updateCategoryTitle",
  "category/updateCategoryColor",
]);
function command(topic, args, view) {
  const [a, b, c, d, e] = args;
  const make = (kind, id, op, changes, parent) => ({
    entityType: kind,
    entityId: id,
    operation: op,
    changes,
    parentId: parent,
  });
  const clean = (raw, keys) =>
    Object.fromEntries(
      keys.filter((k) => raw[k] != null).map((k) => [k, raw[k]])
    );
  switch (topic) {
    case "task/addTask":
      return {
        ...make(
          "task",
          a.tid || randomUUID(),
          "create",
          clean(a, [
            "title",
            "memo",
            "created_at",
            "done",
            "done_at",
            "due_date",
            "repeat_period",
            "repeat_start_at",
          ])
        ),
        categoryIds: Array.isArray(a.categories)
          ? a.categories
          : Object.keys(a.categories || {}),
      };
    case "task/deleteTask":
      return make("task", a, "delete");
    case "task/updateTaskOrder":
      return { ...make("task", a, "move"), anchorId: b, after: c };
    case "task/updateTaskTitle":
      return make("task", a, "patch", { title: b ?? "" });
    case "task/updateTaskMemo":
      return make("task", a, "patch", { memo: b ?? "" });
    case "task/updateTaskDueDate":
      return make("task", a, "patch", { due_date: b ?? 0 });
    case "task/updateTaskRepeatPeriod":
      return make("task", a, "patch", { repeat_period: b ?? "" });
    case "task/updateTaskDone": {
      const row = view.rows.find(
        (r) => r.entityType === "task" && r.entityId === a
      );
      if (b && row?.fields.repeat_period)
        return {
          ...make("task", a, "completeRecurringTask"),
          generation: row.fields.recurrence_generation,
        };
      return make("task", a, "patch", {
        done: b,
        done_at: b ? c || Date.now() : 0,
      });
    }
    case "task/addTaskCategory":
    case "task/deleteTaskCategory":
      return make(
        "taskCategory",
        b,
        topic.includes("add") ? "add" : "remove",
        undefined,
        a
      );
    case "task/createSubtask":
      return make(
        "subtask",
        a.sid || randomUUID(),
        "create",
        clean(a, ["title", "created_at", "done", "done_at", "due_date"]),
        b
      );
    case "task/deleteSubtask":
      return make("subtask", b, "delete", undefined, a);
    case "task/updateSubtaskTitle":
      return make("subtask", b, "patch", { title: c ?? "" }, a);
    case "task/updateSubtaskDueDate":
      return make("subtask", b, "patch", { due_date: c ?? 0 }, a);
    case "task/updateSubtaskDone":
      return make(
        "subtask",
        b,
        "patch",
        { done: c, done_at: c ? d || Date.now() : 0 },
        a
      );
    case "category/createCategory":
      return make(
        "category",
        a.cid || randomUUID(),
        "create",
        clean(a, ["title", "secret", "locked", "color", "created_at"])
      );
    case "category/deleteCategory":
      return make("category", a, "delete");
    case "category/updateCategoryTitle":
      return make("category", a, "patch", { title: b ?? "" });
    case "category/updateCategoryColor":
      return make("category", a, "patch", { color: b ?? "" });
    default:
      throw Error("UNSUPPORTED_V2_ACTION");
  }
}
function entityLists(view) {
  const rows = view.rows.filter(
    (c) => c.operation !== "delete" && c.fields.deleted_at == null
  );
  const tasks = rows
    .filter((c) => c.entityType === "task")
    .sort((a, b) =>
      BigInt(a.fields.sort_rank) < BigInt(b.fields.sort_rank)
        ? -1
        : BigInt(a.fields.sort_rank) > BigInt(b.fields.sort_rank)
        ? 1
        : a.entityId < b.entityId
        ? -1
        : 1
    )
    .map((c) => ({ ...c.fields, tid: c.entityId }));
  tasks.forEach((t, i) => {
    t.next = tasks[i + 1]?.tid || null;
  });
  return {
    tasks,
    categories: rows
      .filter((c) => c.entityType === "category")
      .map((c) => ({ ...c.fields, cid: c.entityId })),
    subtasks: rows
      .filter((c) => c.entityType === "subtask")
      .map((c) => ({ ...c.fields, sid: c.entityId, tid: c.parentId })),
    relations: rows
      .filter((c) => c.entityType === "taskCategory" && c.fields.present)
      .map((c) => ({ tid: c.parentId, cid: c.entityId })),
  };
}
module.exports = {command, entityLists, mutationTopics};
