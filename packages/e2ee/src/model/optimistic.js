// Application data model shared by the desktop and mobile apps: how task, subtask,
// category and task-category rows change locally (moved from the desktop sync-v2 replica).
const identity = (c) =>
  JSON.stringify([c.entityType, c.parentId || "", c.entityId]);
function ordered(rows, exclude) {
  return [...rows.values()]
    .filter(
      (c) =>
        c.entityType === "task" &&
        c.entityId !== exclude &&
        c.operation !== "delete" &&
        c.fields.deleted_at == null
    )
    .sort((a, b) =>
      BigInt(a.fields.sort_rank) < BigInt(b.fields.sort_rank)
        ? -1
        : BigInt(a.fields.sort_rank) > BigInt(b.fields.sort_rank)
        ? 1
        : a.entityId < b.entityId
        ? -1
        : a.entityId === b.entityId
        ? 0
        : 1
    );
}
function optimistic(rows, m) {
  const key = identity(m),
    prior = rows.get(key),
    now = m.localTime;
  const live = (c) =>
    c && c.operation !== "delete" && c.fields.deleted_at == null;
  const task = (id) => rows.get(identity({ entityType: "task", entityId: id }));
  if (m.entityType === "subtask" && !live(task(m.parentId)))
    throw Error("PARENT_DELETED");
  const fields = { ...prior?.fields, ...m.changes, updated_at: now };
  if (m.entityType === "task" && m.operation === "patch" &&
      ["due_date", "repeat_period", "repeat_start_at"].some(k =>
        Object.hasOwn(m.changes || {}, k) && m.changes[k] !== prior?.fields[k])) {
    fields.recurrence_generation = String(BigInt(prior?.fields.recurrence_generation || "0") + 1n);
  }
  if (m.operation === "create") {
    if (prior) throw Error("ENTITY_EXISTS");
    Object.assign(fields, { created_at: fields.created_at ?? now });
    if (m.entityType === "task") {
      Object.assign(fields, {
        memo: fields.memo ?? "",
        done: fields.done ?? false,
        done_at: fields.done_at ?? 0,
        due_date: fields.due_date ?? 0,
        repeat_period: fields.repeat_period ?? "",
        repeat_start_at: fields.repeat_start_at ?? 0,
        recurrence_generation: "0",
        sort_rank: "0",
      });
    }
    if (m.entityType === "subtask")
      Object.assign(fields, {
        done: fields.done ?? false,
        done_at: fields.done_at ?? 0,
        due_date: fields.due_date ?? 0,
      });
    if (m.entityType === "category")
      Object.assign(fields, {
        secret: fields.secret ?? false,
        locked: fields.locked ?? false,
        color: fields.color ?? "",
      });
  } else if (m.entityType !== "taskCategory" && !live(prior)) {
    throw Error("ENTITY_DELETED");
  }
  if (["add", "remove"].includes(m.operation)) {
    if (
      !live(task(m.parentId)) ||
      !live(
        rows.get(identity({ entityType: "category", entityId: m.entityId }))
      )
    )
      throw Error("RELATION_TARGET_DELETED");
    fields.present = m.operation === "add";
  }
  if (m.operation === "completeRecurringTask") {
    // Keep the intent durable. The server owns calendar/occurrence generation;
    // do not invent a different local clone ID or next date before its receipt.
    throw Error("RECURRING_COMPLETION_PENDING");
  }
  if (Object.hasOwn(m.changes || {}, "done")) {
    fields.done_at = fields.done ? m.changes.done_at || now : 0;
  }
  if (m.operation === "delete") {
    if (
      m.entityType === "category" &&
      [...rows.values()].some(
        (c) =>
          c.entityType === "taskCategory" &&
          c.entityId === m.entityId &&
          c.fields.present
      )
    )
      throw Error("CATEGORY_IN_USE");
    fields.deleted_at = now;
    if (m.entityType === "task") {
      for (const [id, c] of rows) {
        if (c.parentId !== m.entityId) continue;
        if (c.entityType === "subtask")
          rows.set(id, {
            ...c,
            operation: "delete",
            fields: { ...c.fields, deleted_at: now },
          });
        if (c.entityType === "taskCategory")
          rows.set(id, { ...c, fields: { ...c.fields, present: false } });
      }
    }
  }
  if (
    m.entityType === "task" &&
    (m.operation === "create" || m.operation === "move")
  ) {
    if (m.operation === "move" && m.anchorId === m.entityId) return;
    let list = ordered(rows, m.entityId),
      index = m.anchorId
        ? list.findIndex((c) => c.entityId === m.anchorId)
        : list.length;
    if (m.anchorId && index < 0) throw Error("ANCHOR_DELETED");
    if (m.anchorId && m.after) index++;
    // Local-only ranks can be rebalanced without changing the immutable request.
    const gap = 4294967296n;
    list.forEach((c, i) => {
      const updated = {
        ...c,
        fields: { ...c.fields, sort_rank: String(BigInt(i + 1) * gap) },
      };
      rows.set(identity(c), updated);
      list[i] = updated;
    });
    const before = index ? BigInt(list[index - 1].fields.sort_rank) : 0n;
    const after =
      index < list.length
        ? BigInt(list[index].fields.sort_rank)
        : before + gap * 2n;
    fields.sort_rank = String((before + after) / 2n);
  }
  rows.set(key, {
    entityType: m.entityType,
    entityId: m.entityId,
    parentId: m.parentId,
    operation: m.operation === "delete" ? "delete" : "upsert",
    version: prior?.version || "0",
    fields,
  });
  if (m.operation === "create" && m.entityType === "task") {
    for (const id of m.categoryIds || [])
      optimistic(rows, {
        entityType: "taskCategory",
        entityId: id,
        parentId: m.entityId,
        operation: "add",
        localTime: now,
      });
  }
}
module.exports = { identity, ordered, optimistic };
