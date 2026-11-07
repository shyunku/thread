const { v4: randomUUID } = require("../uuid");
const { compareRank, compareSubtasks } = require("./optimistic");
const { occurrenceID } = require("../recurrence");
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
  // Periods (#109): the start and the due in one patch, and the per-task alert overrides.
  "task/updateTaskPeriod",
  "task/updateTaskAlert",
  "task/createSubtask",
  "task/deleteSubtask",
  "task/updateSubtaskTitle",
  "task/updateSubtaskDueDate",
  "task/updateSubtaskDone",
  // User-defined subtask order (#106): fields.sort_rank among the task's subtasks.
  "task/updateSubtaskOrder",
  "category/createCategory",
  "category/deleteCategory",
  "category/updateCategoryTitle",
  "category/updateCategoryColor",
  // Normal <-> secret category (#106): fields.secret (and locked, as a create writes it).
  "category/updateCategorySecret",
  "category/updateCategoryOrder",
  // Device names (#77); refused while deviceNames.flags.DEVICE_NAMES_WRITE is off.
  "device/setDeviceName",
  "device/setDeviceModel",
]);
// Renderer-facing actions made of several mutation topics. They are applied together
// (one transaction and one outbox entry on E2EE), so a sync cannot split them.
const compositeTopics = new Set([
  "task/duplicateTask",
  // The undo notice (#107): a deleted task or subtask back as new rows, and a recurring
  // completion taken back (E2EE only: it needs the account's occurrence ids).
  "task/restoreTask",
  "task/restoreSubtask",
  "task/undoRecurringCompletion",
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
          {
            ...clean(a, [
              "title",
              "memo",
              "created_at",
              "done",
              "done_at",
              "due_date",
              "repeat_period",
              "repeat_start_at",
              "important",
            ]),
            ...periodFields(a),
          }
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
    // A period start (#109) is kept as start_offset (ms before the due), so it moves with
    // the due here, as it does on apps from before #109; no due clears it.
    case "task/updateTaskDueDate":
      return make("task", a, "patch", dueChanges(findRow(view, "task", a), b ?? 0));
    // (task id, { due, start }): start is a time before the due, or 0 for no period. Both go in
    // one patch, with the due's repeat-anchor rules.
    case "task/updateTaskPeriod": {
      const due = b?.due ?? 0, start = b?.start ?? 0;
      if (!Number.isSafeInteger(due) || due < 0 || !Number.isSafeInteger(start) || start < 0) throw Error("INVALID_PERIOD");
      if (!due && start) throw Error("INVALID_PERIOD");
      const row = findRow(view, "task", a), changes = dueChanges(row, due);
      if (due) changes.start_offset = periodOffset(due, start);
      return make("task", a, "patch", changes);
    }
    // (task id, "start" | "end", "on" | "off" | null): null follows the settings again.
    case "task/updateTaskAlert": {
      if (b !== "start" && b !== "end") throw Error("INVALID_ALERT");
      if (c !== "on" && c !== "off" && c != null) throw Error("INVALID_ALERT");
      return make("task", a, "patch", { ["alert_" + b]: c ?? null });
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
    // Internal step of task/undoRecurringCompletion, not a renderer topic: the due date alone,
    // so the repeat anchor stays where it was (the completion never moved it).
    case "task/restoreRecurringDue":
      return make("task", a, "patch", { due_date: b });
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
    // (task id, subtask id, anchor subtask id, after the anchor), like the category move.
    case "task/updateSubtaskOrder":
      return { ...make("subtask", b, "move", undefined, a), anchorId: c, after: d };
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
    // Only a real true makes it secret; a new secret category starts locked, so both flip.
    case "category/updateCategorySecret":
      return make("category", a, "patch", { secret: b === true, locked: b === true });
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
// The patch a new due makes. A repeating task keeps its rule on the new day: the recurrence
// anchor moves with the due date. Without a due date the repeat cannot stand, so it is cleared
// in the same patch (prepareSchedule rejects a repeat with no due), and so is a period start.
// A start_offset left on a row without a due (an older app cleared only due_date) is cleared
// when a due is set again, so it does not come back as a period.
// Saving the same due date leaves the anchor alone: after a completion the anchor and the due
// date differ, and rewriting it would bump the recurrence generation.
function dueChanges(row, due) {
  const orphan = !row?.fields.due_date;
  const clearStart = (!due || orphan) && row?.fields.start_offset ? { start_offset: 0 } : {};
  if (!row?.fields.repeat_period || (due && due === row.fields.due_date)) return { due_date: due, ...clearStart };
  return due ? { due_date: due, repeat_start_at: due, ...clearStart } : { due_date: 0, repeat_period: "", repeat_start_at: 0, ...clearStart };
}
// start_offset for a start (ms) before a due: 0 for none or a start equal to the due; a start
// after the due is refused.
function periodOffset(due, start) {
  if (!start || start === due) return 0;
  if (start > due) throw Error("INVALID_PERIOD");
  return due - start;
}
// The period and alert fields a new task (quick add, a copy, a restore) may carry, checked.
// An offset counts only with a due (without one it is dropped) and must leave the start after
// 0; alerts are "on" or "off".
function periodFields(raw) {
  const out = {}, offset = raw.start_offset, due = raw.due_date;
  if (offset != null && offset !== 0 && due) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(due) || offset >= due) throw Error("INVALID_PERIOD");
    out.start_offset = offset;
  }
  for (const key of ["alert_start", "alert_end"]) {
    if (raw[key] == null) continue;
    if (raw[key] !== "on" && raw[key] !== "off") throw Error("INVALID_ALERT");
    out[key] = raw[key];
  }
  return out;
}
function findRow(view, type, id) {
  return view?.rows?.find((r) => r.entityType === type && r.entityId === id);
}
// A restore (#107) checks the snapshot the renderer kept: a missing time is 0, anything
// else must be a time; names must be text.
function restoreTime(value) {
  if (value == null || value === 0) return 0;
  if (!Number.isSafeInteger(value) || value < 0) throw Error("INVALID_RESTORE");
  return value;
}
function restoreText(value) {
  if (typeof value !== "string") throw Error("INVALID_RESTORE");
  return value;
}
// A deleted subtask as a new row with a new id (a deleted id is never created again, see
// ENTITY_EXISTS), with its name, done state and times.
function restoredSubtask(raw) {
  if (!raw || typeof raw !== "object") throw Error("INVALID_RESTORE");
  const subtask = { sid: randomUUID(), title: restoreText(raw.title), done: raw.done === true };
  const created = restoreTime(raw.created_at),
    doneAt = restoreTime(raw.done_at),
    due = restoreTime(raw.due_date);
  if (created) subtask.created_at = created;
  if (subtask.done && doneAt) subtask.done_at = doneAt;
  if (due) subtask.due_date = due;
  return subtask;
}
// A copy's period and alert overrides: only valid ones, and the period only with a due.
function copiedPeriod(f) {
  const out = {};
  if (f.due_date && Number.isSafeInteger(f.start_offset) && f.start_offset > 0 && f.start_offset < f.due_date)
    out.start_offset = f.start_offset;
  for (const key of ["alert_start", "alert_end"]) if (f[key] === "on" || f[key] === "off") out[key] = f[key];
  return out;
}
const ranked = (r) =>
  typeof r.fields.sort_rank === "string" && /^(0|[1-9][0-9]*)$/.test(r.fields.sort_rank);
// Where a restored row goes: after the neighbour it had before, else before the one after it.
function restoreAnchor(live, near) {
  if (live(near?.prevId)) return [near.prevId, true];
  if (live(near?.nextId)) return [near.nextId, false];
  return null;
}
// The mutation topics a composite topic stands for, in order. IDs for new rows are
// chosen here so every step agrees on them. context.accountId (E2EE) names the rows a
// recurring completion made.
function expand(topic, args, view, now = Date.now(), context = {}) {
  const [a, b, c] = args;
  const rows = view.rows;
  switch (topic) {
    // Copies title, memo, due, period, alerts, repeat, importance, categories and subtasks into a
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
      // The period and the task's own alert choices go with the copy (#109).
      Object.assign(task, copiedPeriod(f));
      if (f.important === true) task.important = true;
      // The copies get no rank: increasing created_at keeps the shown order (#106).
      const subtasks = rows
        .filter(
          (r) => r.entityType === "subtask" && r.parentId === a && liveRow(r)
        )
        .sort(compareRank);
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
    // A deleted task back (#107 undo), from the renderer's snapshot: title, memo, done, times,
    // due, repeat, importance, the categories that still exist, its subtasks in their shown
    // order with their done state, and its place next to its old neighbour (prevId / nextId).
    // New ids: the deleted rows stay deleted.
    case "task/restoreTask": {
      if (!a || typeof a !== "object") throw Error("INVALID_RESTORE");
      const cats = a.categories ?? [],
        subs = a.subtasks ?? [];
      if (!Array.isArray(cats) || !Array.isArray(subs)) throw Error("INVALID_RESTORE");
      const tid = typeof a.tid === "string" && a.tid ? a.tid : randomUUID();
      const task = {
        tid,
        title: restoreText(a.title),
        memo: a.memo == null ? "" : restoreText(a.memo),
        done: a.done === true,
        categories: [...new Set(cats.map(restoreText))].filter((cid) =>
          liveRow(findRow(view, "category", cid))
        ),
      };
      const created = restoreTime(a.created_at),
        doneAt = restoreTime(a.done_at),
        due = restoreTime(a.due_date);
      if (created) task.created_at = created;
      if (task.done && doneAt) task.done_at = doneAt;
      if (due) task.due_date = due;
      if (due && a.repeat_period) {
        task.repeat_period = restoreText(a.repeat_period);
        task.repeat_start_at = restoreTime(a.repeat_start_at) || due;
      }
      // The period and alert overrides (#109); addTask checks them.
      if (due && restoreTime(a.start_offset)) task.start_offset = a.start_offset;
      for (const key of ["alert_start", "alert_end"]) if (a[key] != null) task[key] = a[key];
      if (a.important === true) task.important = true;
      const anchor = restoreAnchor(
        (id) => typeof id === "string" && liveRow(findRow(view, "task", id)),
        a
      );
      const subtasks = subs.map(restoredSubtask);
      // New subtasks have no rank and show by created_at; they are moved into the old order
      // only when that order differs (it was dragged, #106).
      const shown = subtasks.map((s) => s.sid).join(),
        natural = [...subtasks]
          .sort((x, y) => compareSubtasks({ created_at: now, ...x }, { created_at: now, ...y }))
          .map((s) => s.sid)
          .join();
      return [
        ["task/addTask", [task]],
        ...(anchor ? [["task/updateTaskOrder", [tid, ...anchor]]] : []),
        ...subtasks.map((s) => ["task/createSubtask", [s, tid]]),
        ...(shown === natural
          ? []
          : subtasks
              .slice(1)
              .map((s, i) => ["task/updateSubtaskOrder", [tid, s.sid, subtasks[i].sid, true]])),
      ];
    }
    // A deleted subtask back (#107 undo): (task id, its snapshot, { prevId, nextId }). Among
    // unranked subtasks its old created_at puts it back in place; among ranked ones it moves
    // next to its old neighbour.
    case "task/restoreSubtask": {
      if (!liveRow(findRow(view, "task", a))) throw Error("ENTITY_DELETED");
      const subtask = restoredSubtask(b);
      const siblings = rows.filter(
        (r) => r.entityType === "subtask" && r.parentId === a && liveRow(r)
      );
      const anchor = siblings.some(ranked)
        ? restoreAnchor((id) => siblings.some((r) => r.entityId === id), c)
        : null;
      return [
        ["task/createSubtask", [subtask, a]],
        ...(anchor ? [["task/updateSubtaskOrder", [a, subtask.sid, ...anchor]]] : []),
      ];
    }
    // Takes back a recurring completion (#107 undo): deletes the done copy it made (its
    // subtasks go with it), puts the due date back and the subtasks' done state and due dates
    // as the copy kept them. Only the completion just made: the copy of the previous
    // generation must be there with the due date the renderer saw (b.due_date); anything
    // else (completed again, due changed, copy deleted) is STALE_OCCURRENCE.
    case "task/undoRecurringCompletion": {
      const row = findRow(view, "task", a);
      if (!liveRow(row) || !row.fields.repeat_period) throw Error("NOT_RECURRING");
      if (!context.accountId) throw Error("UNSUPPORTED_V2_ACTION");
      const g = row.fields.recurrence_generation;
      if (typeof g !== "string" || !/^[1-9][0-9]*$/.test(g)) throw Error("STALE_OCCURRENCE");
      const generation = String(BigInt(g) - 1n),
        occurrence = (child) => occurrenceID(context.accountId, a, generation, child);
      const copy = findRow(view, "task", occurrence("task")),
        due = restoreTime(b?.due_date);
      if (!liveRow(copy) || !due || copy.fields.due_date !== due) throw Error("STALE_OCCURRENCE");
      const steps = [
        ["task/deleteTask", [copy.entityId]],
        ["task/restoreRecurringDue", [a, due]],
      ];
      for (const r of rows) {
        if (r.entityType !== "subtask" || r.parentId !== a || !liveRow(r)) continue;
        const old = findRow(view, "subtask", occurrence("subtask:" + r.entityId))?.fields;
        // A subtask added after the completion has no copy and stays as it is.
        if (!old) continue;
        if ((old.done === true) !== (r.fields.done === true))
          steps.push(["task/updateSubtaskDone", [a, r.entityId, old.done === true, old.done_at]]);
        if ((old.due_date || 0) !== (r.fields.due_date || 0))
          steps.push(["task/updateSubtaskDueDate", [a, r.entityId, old.due_date || 0]]);
      }
      return steps;
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
    // Subtask order (#106), the same on every app: sort_rank, then created_at, then id.
    subtasks: rows
      .filter((c) => c.entityType === "subtask")
      .sort(compareRank)
      .map((c) => ({ ...c.fields, sid: c.entityId, tid: c.parentId })),
    relations: rows
      .filter((c) => c.entityType === "taskCategory" && c.fields.present)
      .map((c) => ({ tid: c.parentId, cid: c.entityId })),
    // [{deviceId, name, model}] for every readable name row, members or not (#77).
    deviceNames: deviceNames.namesFromRows(rows),
  };
}
module.exports = {command, expand, entityLists, mutationTopics, compositeTopics};
