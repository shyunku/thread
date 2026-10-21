// Application data model shared by the desktop and mobile apps: how task, subtask,
// category and task-category rows change locally (moved from the desktop sync-v2 replica).
const identity = (c) =>
  JSON.stringify([c.entityType, c.parentId || "", c.entityId]);
// sort_rank is a string bigint. Categories from before #102 have none: they sort after
// ranked ones, by created_at, until the first move or create ranks them all.
const rankOf = (c) =>
  typeof c.fields.sort_rank === "string" &&
  /^(0|[1-9][0-9]*)$/.test(c.fields.sort_rank)
    ? BigInt(c.fields.sort_rank)
    : null;
function compareRank(a, b) {
  const x = rankOf(a),
    y = rankOf(b);
  if (x !== y) return x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
  if (a.entityType === "category") {
    const t = (a.fields.created_at || 0) - (b.fields.created_at || 0);
    if (t) return t < 0 ? -1 : 1;
  }
  return a.entityId < b.entityId ? -1 : a.entityId === b.entityId ? 0 : 1;
}
// Ordered task (or category) rows, the list a move or create ranks against.
function ordered(rows, exclude, entityType = "task") {
  return [...rows.values()]
    .filter(
      (c) =>
        c.entityType === entityType &&
        c.entityId !== exclude &&
        c.operation !== "delete" &&
        c.fields.deleted_at == null
    )
    .sort(compareRank);
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
    (m.entityType === "task" || m.entityType === "category") &&
    (m.operation === "create" || m.operation === "move")
  ) {
    if (m.operation === "move" && m.anchorId === m.entityId) return;
    let list = ordered(rows, m.entityId, m.entityType),
      index = m.anchorId
        ? list.findIndex((c) => c.entityId === m.anchorId)
        : list.length;
    if (m.anchorId && index < 0) throw Error("ANCHOR_DELETED");
    if (m.anchorId && m.after) index++;
    // Local-only ranks can be rebalanced without changing the immutable request.
    const gap = 4294967296n;
    // Rows already at their rank stay the same object, so callers can tell which
    // rows this action really changed.
    const setRank = (i, value) => {
      const c = list[i],
        rank = String(value);
      if (c.fields.sort_rank === rank) return;
      const updated = { ...c, fields: { ...c.fields, sort_rank: rank } };
      rows.set(identity(c), updated);
      list[i] = updated;
    };
    const rankAt = (i) => BigInt(list[i].fields.sort_rank);
    const rerank = () => list.forEach((c, i) => setRank(i, BigInt(i + 1) * gap));
    if (m.entityType === "category") {
      // Category ranks are encrypted objects that sync: rewriting them all on every move
      // would let two devices' concurrent moves mix into an order neither chose. Rows
      // without a rank (older clients) get one after the ranked rows; the rest stay, and
      // all are re-ranked only when the neighbours leave no room.
      list.forEach((c, i) => {
        if (rankOf(c) === null) setRank(i, (i ? rankAt(i - 1) : 0n) + gap);
      });
      const low = index ? rankAt(index - 1) : 0n;
      if (index < list.length && rankAt(index) - low < 2n) rerank();
    } else rerank();
    const before = index ? rankAt(index - 1) : 0n;
    const after = index < list.length ? rankAt(index) : before + gap * 2n;
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
module.exports = { identity, ordered, compareRank, optimistic };
