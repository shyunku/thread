const crypto = require("crypto");
const { v5 } = require("uuid");
const { identity, optimistic, hash } = require("./replica");
const columns = {
  task: [
    "title",
    "memo",
    "done",
    "done_at",
    "due_date",
    "repeat_period",
    "repeat_start_at",
    "created_at",
  ],
  subtask: ["title", "done", "done_at", "due_date", "created_at"],
  category: ["title", "secret", "locked", "color", "created_at"],
  taskCategory: ["present"],
};
const textFields = new Set(["title", "memo", "repeat_period", "color"]);
const boolFields = new Set(["done", "secret", "locked", "present"]);
function fields(kind, raw) {
  return Object.fromEntries(
    columns[kind].map((key) => {
      let v = raw[key];
      if (textFields.has(key)) {
        if (v == null) v = "";
        if (typeof v !== "string") throw Error("INVALID_LEGACY_FIELD");
      } else if (boolFields.has(key)) {
        if (![null, undefined, 0, 1, false, true].includes(v))
          throw Error("INVALID_LEGACY_FIELD");
        v = !!v;
      } else {
        if (v == null) v = 0;
        if (!Number.isSafeInteger(v)) throw Error("INVALID_LEGACY_DATE");
      }
      return [key, v];
    })
  );
}
const bytes = (row) =>
  row.content == null
    ? null
    : Buffer.from(
        row.content.type === "Buffer" ? row.content.data : row.content
      );
function digestTx(row) {
  const content = bytes(row);
  return hash(
    JSON.stringify({
      Version: row.version,
      Type: row.type,
      Timestamp: row.timestamp,
      Content: content === null ? null : content.toString("base64"),
    })
  );
}
function classify(source, proof, uid) {
  if (proof.userId !== uid || !Array.isArray(proof.blocks))
    throw Error("LEGACY_PROOF_SCOPE");
  const known = new Map(proof.blocks.map((b) => [b.txHash, b]));
  const local = [...source.transactions].sort(
    (a, b) => a.block_number - b.block_number
  );
  const seen = new Set();
  let base = "0",
    pending = false,
    lastNumber = 0;
  const records = local.map((row) => {
    if (
      row.version !== 2 ||
      !Number.isSafeInteger(row.type) ||
      !Number.isSafeInteger(row.timestamp)
    )
      throw Error("UNSUPPORTED_LOCAL_HISTORY");
    if (
      typeof row.hash !== "string" ||
      !row.hash ||
      seen.has(row.hash) ||
      !Number.isSafeInteger(row.block_number) ||
      row.block_number <= lastNumber
    )
      throw Error("AMBIGUOUS_LOCAL_HISTORY");
    seen.add(row.hash);
    lastNumber = row.block_number;
    const checksum = digestTx(row),
      remote = known.get(row.hash);
    if (remote) {
      if (
        remote.txUserId !== uid ||
        remote.txDigest !== checksum ||
        remote.txVersion !== row.version ||
        remote.txType !== row.type
      )
        throw Error("LEGACY_PROVENANCE_MISMATCH");
      if (pending) throw Error("LEGACY_FORK_REVIEW_REQUIRED");
      base = remote.number;
    } else {
      pending = true;
    }
    return { row, checksum, decision: remote ? "committed" : "pending" };
  });
  if (
    base === "0" &&
    proof.blocks.length &&
    records.some((r) => r.decision === "pending")
  )
    throw Error("COMMON_BASE_REQUIRED");
  return { base, records };
}
function fromBase(base) {
  const rows = new Map();
  for (const [table, kind] of [
    ["categories", "category"],
    ["tasks", "task"],
    ["subtasks", "subtask"],
    ["taskCategories", "taskCategory"],
  ]) {
    for (const raw of base[table]) {
      const c = {
        entityType: kind,
        entityId: kind === "taskCategory" ? raw.category_id : raw.id,
        parentId: raw.task_id,
        operation: "create",
        version: "0",
        fields: fields(kind, raw),
      };
      if (kind === "task") {
        c.fields.sort_rank = raw.sort_rank;
        c.fields.recurrence_generation = "0";
      }
      if (rows.has(identity(c))) throw Error("DUPLICATE_LEGACY_ENTITY");
      rows.set(identity(c), c);
    }
  }
  return rows;
}
function fromLocal(source) {
  const rows = new Map();
  for (const [table, kind, key] of [
    ["categories", "category", "cid"],
    ["tasks", "task", "tid"],
    ["subtasks", "subtask", "sid"],
    ["tasks_categories", "taskCategory", "cid"],
  ]) {
    for (const raw of source[table]) {
      const c = {
        entityType: kind,
        entityId: raw[key],
        parentId:
          kind === "subtask" || kind === "taskCategory" ? raw.tid : undefined,
        operation: "create",
        version: "0",
        fields: fields(kind, { ...raw, present: true }),
      };
      if (
        typeof c.entityId !== "string" ||
        !c.entityId ||
        rows.has(identity(c))
      )
        throw Error("DUPLICATE_LEGACY_ENTITY");
      rows.set(identity(c), c);
    }
  }
  const tasks = new Map(source.tasks.map((t) => [t.tid, t])),
    incoming = new Set();
  for (const t of tasks.values()) {
    if (t.next) {
      if (!tasks.has(t.next) || incoming.has(t.next))
        throw Error("INVALID_LEGACY_ORDER");
      incoming.add(t.next);
    }
  }
  const heads = [...tasks.keys()].filter((id) => !incoming.has(id));
  if (tasks.size && heads.length !== 1) throw Error("INVALID_LEGACY_ORDER");
  let id = heads[0],
    n = 0;
  const visited = new Set();
  while (id) {
    if (visited.has(id)) throw Error("INVALID_LEGACY_ORDER");
    visited.add(id);
    rows.get(identity({ entityType: "task", entityId: id })).fields.sort_rank =
      String(BigInt(++n) * 4294967296n);
    id = tasks.get(id).next;
  }
  if (n !== tasks.size) throw Error("INVALID_LEGACY_ORDER");
  return rows;
}
function comparable(rows) {
  const alive = [...rows.values()].filter(
    (c) => c.operation !== "delete" && c.fields.deleted_at == null
  );
  const order = alive
    .filter((c) => c.entityType === "task")
    .sort((a, b) =>
      BigInt(a.fields.sort_rank) < BigInt(b.fields.sort_rank) ? -1 : 1
    )
    .map((c) => c.entityId);
  const values = alive
    .filter((c) => c.entityType !== "taskCategory" || c.fields.present)
    .map((c) => [identity(c), fields(c.entityType, c.fields)])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  // Ensure every relationship survives conversion, not just entity counts.
  for (const c of alive) {
    if (["subtask", "taskCategory"].includes(c.entityType)) {
      const parent = rows.get(
        identity({ entityType: "task", entityId: c.parentId })
      );
      if (c.entityType === "taskCategory" && !c.fields.present) continue;
      if (!parent || parent.operation === "delete")
        throw Error("LEGACY_ORPHAN");
      if (
        c.entityType === "taskCategory" &&
        !rows.has(identity({ entityType: "category", entityId: c.entityId }))
      )
        throw Error("LEGACY_ORPHAN");
    }
  }
  return JSON.stringify({ order, values });
}
function convert(row, rows) {
  const raw = bytes(row);
  if (!raw) throw Error("INVALID_LEGACY_CONTENT");
  const c = JSON.parse(raw.toString("utf8")),
    type = row.type;
  const task = (id) => rows.get(identity({ entityType: "task", entityId: id }));
  const m = {
    entityType: "task",
    entityId: c.tid,
    operation: "patch",
    baseVersion: "0",
    localTime: row.timestamp,
  };
  const patch = (key, value) => {
    m.changes = { [key]: value };
    return m;
  };
  switch (type) {
    case 0:
      throw Error("LEGACY_INITIALIZE_REVIEW_REQUIRED");
    case 10000: {
      Object.assign(m, {
        operation: "create",
        changes: fields("task", {
          title: c.title,
          memo: c.memo,
          done: c.done,
          done_at: c.doneAt,
          due_date: c.dueDate,
          repeat_period: c.repeatPeriod,
          repeat_start_at: c.repeatStartAt,
          created_at: c.createdAt,
        }),
        categoryIds: Object.keys(c.categories || {}),
        anchorId: c.prevTaskId || "",
        after: !!c.prevTaskId,
      });
      if (!c.prevTaskId) {
        const head = [...rows.values()]
          .filter((r) => r.entityType === "task" && r.operation !== "delete")
          .sort((a, b) =>
            BigInt(a.fields.sort_rank) < BigInt(b.fields.sort_rank) ? -1 : 1
          )[0];
        if (head) m.anchorId = head.entityId;
      }
      return m;
    }
    case 10001:
      m.operation = "delete";
      return m;
    case 10002:
      Object.assign(m, {
        operation: "move",
        anchorId: c.targetTaskId,
        after: c.afterTarget,
      });
      return m;
    case 10003:
      return patch("title", c.title ?? "");
    case 10004:
      return patch("due_date", c.dueDate ?? 0);
    case 10005:
      return patch("memo", c.memo ?? "");
    case 10006:
      if (c.done && task(c.tid)?.fields.repeat_period)
        throw Error("LEGACY_RECURRENCE_REVIEW_REQUIRED");
      m.changes = {
        done: !!c.done,
        done_at: c.done ? c.doneAt || row.timestamp : 0,
      };
      return m;
    case 10007:
      throw Error("LEGACY_SCHEDULE_REVIEW_REQUIRED");
    case 10100:
    case 10101:
      Object.assign(m, {
        entityType: "taskCategory",
        entityId: c.cid,
        parentId: c.tid,
        operation: type === 10100 ? "add" : "remove",
      });
      return m;
    case 11000:
      Object.assign(m, {
        entityType: "subtask",
        entityId: c.sid,
        parentId: c.tid,
        operation: "create",
        changes: fields("subtask", {
          title: c.title,
          done: c.done,
          done_at: c.doneAt,
          due_date: c.dueDate,
          created_at: c.createdAt,
        }),
      });
      return m;
    case 11001:
      Object.assign(m, {
        entityType: "subtask",
        entityId: c.sid,
        parentId: c.tid,
        operation: "delete",
      });
      return m;
    case 11002:
    case 11003:
    case 11004:
      Object.assign(m, {
        entityType: "subtask",
        entityId: c.sid,
        parentId: c.tid,
      });
      if (type === 11002) return patch("title", c.title ?? "");
      if (type === 11003) return patch("due_date", c.dueDate ?? 0);
      m.changes = {
        done: !!c.done,
        done_at: c.done ? c.doneAt || row.timestamp : 0,
      };
      return m;
    case 12000:
      Object.assign(m, {
        entityType: "category",
        entityId: c.cid,
        operation: "create",
        changes: fields("category", {
          title: c.title,
          secret: c.secret,
          locked: c.locked,
          color: c.color,
          created_at: c.createdAt,
        }),
      });
      return m;
    case 12001:
      Object.assign(m, {
        entityType: "category",
        entityId: c.cid,
        operation: "delete",
      });
      return m;
    case 12002:
      Object.assign(m, { entityType: "category", entityId: c.cid });
      return patch("color", c.color ?? "");
    default:
      throw Error("UNSUPPORTED_LEGACY_TRANSACTION");
  }
}
function planImport(source, proof, baseProof, uid) {
  if (
    baseProof.sourceChecksum !== proof.sourceChecksum ||
    baseProof.epoch !== proof.epoch ||
    baseProof.userId !== uid
  )
    throw Error("LEGACY_PROOF_CHANGED");
  const classification = classify(source, proof, uid),
    rows = fromBase(baseProof.baseRows);
  if (baseProof.baseNumber !== classification.base)
    throw Error("LEGACY_BASE_MISMATCH");
  const records = [];
  for (const item of classification.records) {
    const id = v5(
      "thread:legacy-import:v1:" +
        JSON.stringify([uid, item.row.hash, item.checksum]),
      v5.URL
    );
    let mutation;
    if (item.decision === "pending") {
      mutation = convert(item.row, rows);
      optimistic(rows, mutation);
      if (Buffer.byteLength(JSON.stringify(mutation)) > 900 * 1024)
        throw Error("LEGACY_MUTATION_SIZE_REVIEW_REQUIRED");
    }
    records.push({
      identity: item.row.hash,
      checksum: item.checksum,
      decision: item.decision,
      changeId: id,
      mutation,
    });
  }
  if (comparable(rows) !== comparable(fromLocal(source)))
    throw Error("LEGACY_STATE_PARITY_FAILED");
  return {
    uid,
    epoch: proof.epoch,
    sourceFingerprint: hash(JSON.stringify(source)),
    serverFingerprint: proof.sourceChecksum,
    records,
  };
}
module.exports = { classify, planImport, digestTx, fromLocal, comparable };
