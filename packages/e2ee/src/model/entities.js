const { v4: randomUUID } = require("../uuid");
const { compareRank } = require("./optimistic");
const deviceNames = require("./deviceNames");
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
  "task/updateTaskImportant",
  "task/createSubtask",
  "task/deleteSubtask",
  "task/updateSubtaskTitle",
  "task/updateSubtaskDueDate",
  "task/updateSubtaskDone",
  "category/createCategory",
  "category/deleteCategory",
  "category/updateCategoryTitle",
  "category/updateCategoryColor",
  "category/updateCategoryOrder",
  // Device names (#77); refused while deviceNames.flags.DEVICE_NAMES_WRITE is off.
  "device/setDeviceName",
  "device/setDeviceModel",
]);
// Renderer-facing actions made of several mutation topics. They are applied together
// (one transaction and one outbox entry on E2EE), so a sync cannot split them.
const compositeTopics = new Set([
  "task/duplicateTask",
  "category/deleteCategoryInUse",
  "category/deleteCategoryWithTasks",
]);
const liveRow = (c) => c && c.operation !== "delete" && c.fields.deleted_at == null;
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
            "important",
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
    case "task/updateTaskDueDate": {
      // A repeating task keeps its rule on the new day: the recurrence anchor moves
      // with the due date. Without a due date the repeat cannot stand, so it is
      // cleared in the same patch (prepareSchedule rejects a repeat with no due).
      // Saving the same due date leaves the anchor alone: after a completion the anchor
      // and the due date differ, and rewriting it would bump the recurrence generation.
      const due = b ?? 0,
        row = findRow(view, "task", a);
      if (!row?.fields.repeat_period || (due && due === row.fields.due_date))
        return make("task", a, "patch", { due_date: due });
      return make(
        "task",
        a,
        "patch",
        due
          ? { due_date: due, repeat_start_at: due }
          : { due_date: 0, repeat_period: "", repeat_start_at: 0 }
      );
    }
    case "task/updateTaskRepeatPeriod": {
      // The anchor moves to the current due date when a repeat is turned on or its
      // period changes (the picker names the rule by the due date, "매월 21일"), and is
      // dropped when it is turned off, so an old anchor never comes back later.
      // Picking the same period again changes nothing.
      const period = b ?? "",
        row = findRow(view, "task", a);
      if (!period)
        return make("task", a, "patch", { repeat_period: "", repeat_start_at: 0 });
      if (row?.fields.repeat_period !== period && row?.fields.due_date)
        return make("task", a, "patch", {
          repeat_period: period,
          repeat_start_at: row.fields.due_date,
        });
      return make("task", a, "patch", { repeat_period: period });
    }
    // Starred ("중요", #97). Always a boolean; a task without the key is not starred.
    case "task/updateTaskImportant":
      return make("task", a, "patch", { important: b === true });
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
    // User-defined sidebar order (#102): fields.sort_rank, like the task move.
    case "category/updateCategoryOrder":
      return { ...make("category", a, "move"), anchorId: b, after: c };
    // Device names (#77): one row per device id, created on the first write and patched
    // after (never deleted, so never recreated). An empty name goes back to the model the
    // device wrote for itself.
    case "device/setDeviceName": {
      deviceNames.requireWritable();
      const id = deviceNames.requireDeviceId(a),
        row = findRow(view, "deviceName", id);
      const typed = typeof b === "string" ? b.trim() : b;
      const name = deviceNames.requireName(
        typed === "" ? deviceNames.cleanName(row?.fields.model) ?? "" : typed
      );
      return make("deviceName", id, row ? "patch" : "create", { name });
    }
    // A device's own model (its default name), written by that device once (2.5.0).
    case "device/setDeviceModel": {
      deviceNames.requireWritable();
      const id = deviceNames.requireDeviceId(a),
        row = findRow(view, "deviceName", id),
        model = deviceNames.requireName(b);
      if (row) return make("deviceName", id, "patch", { model });
      return make("deviceName", id, "create", { name: model, model });
    }
    default:
      throw Error("UNSUPPORTED_V2_ACTION");
  }
}
function findRow(view, type, id) {
  return view?.rows?.find((r) => r.entityType === type && r.entityId === id);
}
// The mutation topics a composite topic stands for, in order. IDs for new rows are
// chosen here so every step agrees on them.
function expand(topic, args, view, now = Date.now()) {
  const [a, b] = args;
  const rows = view.rows;
  switch (topic) {
    // Copies title, memo, due, repeat, importance, categories and subtasks into a
    // new, not-done task. Subtasks keep their order and start not done.
    case "task/duplicateTask": {
      const source = findRow(view, "task", a);
      if (!liveRow(source)) throw Error("ENTITY_DELETED");
      const f = source.fields,
        tid = b?.tid || randomUUID();
      const categories = rows
        .filter(
          (r) =>
            r.entityType === "taskCategory" &&
            r.parentId === a &&
            r.fields.present &&
            liveRow(findRow(view, "category", r.entityId))
        )
        .map((r) => r.entityId);
      const task = { tid, title: f.title ?? "", memo: f.memo ?? "", categories };
      if (f.due_date) task.due_date = f.due_date;
      if (f.due_date && f.repeat_period) {
        task.repeat_period = f.repeat_period;
        task.repeat_start_at = f.repeat_start_at || f.due_date;
      }
      if (f.important === true) task.important = true;
      const subtasks = rows
        .filter(
          (r) => r.entityType === "subtask" && r.parentId === a && liveRow(r)
        )
        .sort(
          (x, y) =>
            (x.fields.created_at || 0) - (y.fields.created_at || 0) ||
            (x.entityId < y.entityId ? -1 : 1)
        );
      return [
        ["task/addTask", [task]],
        ...subtasks.map((r, i) => {
          const subtask = {
            sid: randomUUID(),
            title: r.fields.title ?? "",
            created_at: now + i,
          };
          if (r.fields.due_date) subtask.due_date = r.fields.due_date;
          return ["task/createSubtask", [subtask, tid]];
        }),
      ];
    }
    // Takes the category off every task that has it, then deletes it. Tasks stay.
    case "category/deleteCategoryInUse": {
      if (!liveRow(findRow(view, "category", a))) throw Error("ENTITY_DELETED");
      return [
        ...rows
          .filter(
            (r) =>
              r.entityType === "taskCategory" &&
              r.entityId === a &&
              r.fields.present
          )
          .map((r) => ["task/deleteTaskCategory", [r.parentId, a]]),
        ["category/deleteCategory", [a]],
      ];
    }
    // Deletes every task that has the category (their subtasks and relations go with
    // them, see optimistic), then the category. Used for secret categories (#102).
    case "category/deleteCategoryWithTasks": {
      if (!liveRow(findRow(view, "category", a))) throw Error("ENTITY_DELETED");
      const tids = [
        ...new Set(
          rows
            .filter(
              (r) =>
                r.entityType === "taskCategory" &&
                r.entityId === a &&
                r.fields.present &&
                liveRow(findRow(view, "task", r.parentId))
            )
            .map((r) => r.parentId)
        ),
      ];
      return [
        ...tids.map((tid) => ["task/deleteTask", [tid]]),
        ["category/deleteCategory", [a]],
      ];
    }
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
    // Sidebar order: sort_rank, then created_at (rows from before #102 have no rank).
    categories: rows
      .filter((c) => c.entityType === "category")
      .sort(compareRank)
      .map((c) => ({ ...c.fields, cid: c.entityId })),
    subtasks: rows
      .filter((c) => c.entityType === "subtask")
      .map((c) => ({ ...c.fields, sid: c.entityId, tid: c.parentId })),
    relations: rows
      .filter((c) => c.entityType === "taskCategory" && c.fields.present)
      .map((c) => ({ tid: c.parentId, cid: c.entityId })),
    // [{deviceId, name, model}] for every readable name row, members or not (#77).
    deviceNames: deviceNames.namesFromRows(rows),
  };
}
module.exports = {command, expand, entityLists, mutationTopics, compositeTopics};
