const crypto = require("crypto");
const sqlite3 = require("sqlite3");
const { migrate } = require("../migrations/schema");

const exec = (db, sql) =>
  new Promise((resolve, reject) =>
    db.exec(sql, (e) => (e ? reject(e) : resolve()))
  );
const all = (db, sql, args = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, args, (e, rows) => (e ? reject(e) : resolve(rows)))
  );
const run = (db, sql, args = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, args, (e) => (e ? reject(e) : resolve()))
  );
const identity = (c) =>
  JSON.stringify([c.entityType, c.parentId || "", c.entityId]);
const hash = (raw) => crypto.createHash("sha256").update(raw).digest("hex");
const schema = [
  {
    version: 1,
    name: "canonical_replica_and_durable_outbox",
    requiredTables: {},
    statements: [
      "CREATE TABLE sync_meta(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL)",
      "CREATE TABLE confirmed_entities(identity TEXT PRIMARY KEY NOT NULL,payload TEXT NOT NULL)",
      "CREATE TABLE visible_entities(identity TEXT PRIMARY KEY NOT NULL,payload TEXT NOT NULL)",
      "CREATE TABLE outbox(local_order INTEGER PRIMARY KEY AUTOINCREMENT,change_id TEXT UNIQUE NOT NULL,request TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',ack TEXT,preview_error TEXT)",
      "CREATE TABLE recovery_items(id TEXT PRIMARY KEY NOT NULL,reason TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL)",
      "CREATE TABLE legacy_imports(identity TEXT PRIMARY KEY NOT NULL,checksum TEXT NOT NULL,decision TEXT NOT NULL,change_id TEXT)",
    ],
  },
];
function validateCursor(token, uid, epoch, seq) {
  const c = JSON.parse(
    Buffer.from(token.split(".")[0], "base64url").toString("utf8")
  );
  if (c.UID !== uid || c.Epoch !== epoch || c.Seq !== seq)
    throw Error("CURSOR_MISMATCH");
}
function validateChange(c) {
  if (
    !["task", "subtask", "category", "taskCategory"].includes(c.entityType) ||
    typeof c.entityId !== "string" ||
    !c.entityId ||
    !/^(0|[1-9][0-9]*)$/.test(c.version) ||
    !c.fields ||
    typeof c.fields !== "object" ||
    Array.isArray(c.fields)
  )
    throw Error("INVALID_CHANGE");
}
function applyConfirmed(rows, change, snapshot = false) {
  validateChange(change);
  const key = identity(change),
    prior = rows.get(key);
  if (snapshot && prior) throw Error("DUPLICATE_ENTITY");
  if (prior && BigInt(prior.version) > BigInt(change.version))
    throw Error("VERSION_REGRESSION");
  if (
    !snapshot &&
    !prior &&
    change.operation === "patch" &&
    change.entityType !== "taskCategory"
  )
    throw Error("MISSING_BASE");
  rows.set(key, { ...change, fields: { ...prior?.fields, ...change.fields } });
}
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
class Replica {
  constructor(db, uid) {
    this.db = db;
    this.uid = uid;
    this.tail = Promise.resolve();
  }
  static async open(file, uid) {
    const db = await new Promise((resolve, reject) => {
      const d = new sqlite3.Database(file, (e) => (e ? reject(e) : resolve(d)));
    });
    try {
      await migrate(db, "sync-v2", file, schema);
      await exec(db, "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      const replica = new Replica(db, uid);
      await replica.serial(async () => {
        const stored = await replica.meta("uid");
        if (stored && stored !== uid) throw Error("ACCOUNT_MISMATCH");
        await replica.setMeta("uid", uid);
        if (!(await replica.meta("deviceId")))
          await replica.setMeta("deviceId", crypto.randomUUID());
      });
      return replica;
    } catch (e) {
      await new Promise((resolve) => db.close(resolve));
      throw e;
    }
  }
  serial(fn) {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
  async transaction(fn) {
    await exec(this.db, "BEGIN IMMEDIATE");
    try {
      const result = await fn();
      await exec(this.db, "COMMIT");
      return result;
    } catch (e) {
      await exec(this.db, "ROLLBACK");
      throw e;
    }
  }
  async meta(key) {
    return (
      await all(this.db, "SELECT value FROM sync_meta WHERE key=?", [key])
    )[0]?.value;
  }
  async setMeta(key, value) {
    await run(
      this.db,
      "INSERT INTO sync_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [key, String(value)]
    );
  }
  async rows(table) {
    return new Map(
      (await all(this.db, "SELECT identity,payload FROM " + table)).map((r) => [
        r.identity,
        JSON.parse(r.payload),
      ])
    );
  }
  async replaceRows(table, rows) {
    const before = new Map((await all(this.db, "SELECT identity,payload FROM " + table))
      .map(row => [row.identity, row.payload]));
    for (const id of before.keys()) {
      if (!rows.has(id)) await run(this.db, "DELETE FROM " + table + " WHERE identity=?", [id]);
    }
    for (const [id, c] of rows) {
      const payload = JSON.stringify(c);
      if (before.get(id) !== payload) {
        await run(this.db, "INSERT INTO " + table +
          " VALUES (?,?) ON CONFLICT(identity) DO UPDATE SET payload=excluded.payload", [id, payload]);
      }
    }
  }
  async rebase() {
    const rows = await this.rows("confirmed_entities");
    for (const item of await all(
      this.db,
      "SELECT * FROM outbox WHERE status IN ('pending','accepted') ORDER BY local_order"
    )) {
      const mutation = JSON.parse(item.request);
      const candidate = new Map(rows);
      try {
        optimistic(candidate, mutation);
        rows.clear();
        for (const [k, v] of candidate) rows.set(k, v);
        await run(
          this.db,
          "UPDATE outbox SET preview_error=NULL WHERE change_id=?",
          [item.change_id]
        );
      } catch (e) {
        await run(
          this.db,
          "UPDATE outbox SET preview_error=? WHERE change_id=?",
          [e.message, item.change_id]
        );
      }
    }
    await this.replaceRows("visible_entities", rows);
  }
  async installSnapshot(s, pages) {
    return this.serial(() =>
      this.transaction(async () => {
        if (s.expiresAt <= Date.now() || pages.length !== s.pageCount)
          throw Error("SNAPSHOT_EXPIRED");
        validateCursor(s.cursor, this.uid, s.epoch, s.seq);
        const priorEpoch = await this.meta("epoch");
        // Epoch changes require explicit recovery, not silently rebinding old IDs.
        if (
          priorEpoch &&
          priorEpoch !== s.epoch &&
          (
            await all(
              this.db,
              "SELECT 1 FROM outbox WHERE status IN ('pending','accepted') LIMIT 1"
            )
          ).length
        )
          throw Error("EPOCH_CHANGED_WITH_PENDING");
        const rows = new Map();
        let size = 0;
        for (const p of pages) {
          if (hash(p.payload) !== p.checksum) throw Error("SNAPSHOT_CHECKSUM");
          size += Buffer.byteLength(p.payload);
          if (size > 128 * 1024 * 1024) throw Error("SNAPSHOT_TOO_LARGE");
          const changes = JSON.parse(p.payload).changes;
          if (!Array.isArray(changes)) throw Error("INVALID_SNAPSHOT");
          for (const c of changes) {
            if (BigInt(c.version) > BigInt(s.seq))
              throw Error("SNAPSHOT_VERSION");
            applyConfirmed(rows, c, true);
          }
        }
        await this.replaceRows("confirmed_entities", rows);
        await this.setMeta("epoch", s.epoch);
        await this.setMeta("cursor", s.cursor);
        await this.setMeta("seq", s.seq);
        await this.settleAcknowledged(s.seq);
        await this.rebase();
      })
    );
  }
  async settleAcknowledged(seq) {
    for (const item of await all(
      this.db,
      "SELECT change_id,ack FROM outbox WHERE status='accepted'"
    )) {
      if (BigInt(JSON.parse(item.ack).seq) <= BigInt(seq))
        await run(
          this.db,
          "UPDATE outbox SET status='applied' WHERE change_id=?",
          [item.change_id]
        );
    }
  }
  async applyPage(page) {
    return this.serial(() =>
      this.transaction(async () => {
        const epoch = await this.meta("epoch");
        if (epoch !== page.epoch) throw Error("RESET_REQUIRED");
        let seq = await this.meta("seq");
        const rows = await this.rows("confirmed_entities");
        for (const entry of page.entries) {
          if (BigInt(entry.seq) !== BigInt(seq) + 1n) throw Error("LOG_GAP");
          for (const c of entry.payload.changes) {
            if (c.version !== entry.seq) throw Error("DELTA_VERSION_MISMATCH");
            applyConfirmed(rows, c);
          }
          const device = await this.meta("deviceId");
          if (entry.deviceId === device)
            await run(
              this.db,
              "UPDATE outbox SET status='applied',ack=? WHERE change_id=?",
              [
                JSON.stringify({ status: "accepted", seq: entry.seq }),
                entry.clientChangeId,
              ]
            );
          seq = entry.seq;
        }
        if (page.hasMore && !page.entries.length) throw Error("LOG_GAP");
        if (!page.hasMore && seq !== page.highWatermark) throw Error("LOG_GAP");
        validateCursor(page.nextCursor, this.uid, epoch, seq);
        await this.replaceRows("confirmed_entities", rows);
        await this.setMeta("seq", seq);
        await this.setMeta("cursor", page.nextCursor);
        await this.settleAcknowledged(seq);
        await this.rebase();
      })
    );
  }
  async enqueue(input) {
    return this.serial(() =>
      this.transaction(async () => {
        if ((await this.meta("migrationBlocked")) === "true")
          throw Error("LEGACY_REVIEW_REQUIRED");
        const epoch = await this.meta("epoch");
        if (!epoch) throw Error("SNAPSHOT_REQUIRED");
        const rows = await this.rows("visible_entities"),
          base = rows.get(identity(input));
        const m = {
          ...input,
          epoch,
          deviceId: await this.meta("deviceId"),
          clientChangeId: crypto.randomUUID(),
          baseVersion: base?.version || "0",
          localTime: Date.now(),
        };
        const preview = new Map(rows);
        try {
          optimistic(preview, m);
        } catch (e) {
          if (e.message !== "RECURRING_COMPLETION_PENDING") throw e;
        }
        await run(
          this.db,
          "INSERT INTO outbox(change_id,request) VALUES (?,?)",
          [m.clientChangeId, JSON.stringify(m)]
        );
        await this.rebase();
        return m.clientChangeId;
      })
    );
  }
  async acknowledge(id, result) {
    return this.serial(() =>
      this.transaction(async () => {
        const item = (
          await all(this.db, "SELECT * FROM outbox WHERE change_id=?", [id])
        )[0];
        if (!item) throw Error("UNKNOWN_ACK");
        if (result.status === "accepted") {
          // Never advance pull cursor from a push ACK.
          await run(
            this.db,
            "UPDATE outbox SET status=?,ack=? WHERE change_id=?",
            [
              item.status === "applied" ? "applied" : "accepted",
              JSON.stringify(result),
              id,
            ]
          );
          await this.settleAcknowledged(await this.meta("seq"));
        } else if (result.status === "rejected") {
          await run(
            this.db,
            "INSERT OR IGNORE INTO recovery_items VALUES (?,?,?,?)",
            [id, result.code, item.request, Date.now()]
          );
          await run(
            this.db,
            "UPDATE outbox SET status='rejected',ack=? WHERE change_id=?",
            [JSON.stringify(result), id]
          );
        }
        await this.rebase();
      })
    );
  }
  async next() {
    return this.serial(async () => {
      const item = (
        await all(
          this.db,
          "SELECT * FROM outbox WHERE status='pending' ORDER BY local_order LIMIT 1"
        )
      )[0];
      if (!item) return null;
      const { localTime, ...request } = JSON.parse(item.request);
      return request;
    });
  }
  async view() {
    return this.serial(async () => ({
      uid: this.uid,
      epoch: await this.meta("epoch"),
      seq: (await this.meta("seq")) || "0",
      rows: [...(await this.rows("visible_entities")).values()],
      pending: await all(
        this.db,
        "SELECT change_id,status,preview_error FROM outbox WHERE status IN ('pending','accepted')"
      ),
      recovery: await all(
        this.db,
        "SELECT id,reason FROM recovery_items WHERE reason<>'LEGACY_IMPORTED'"
      ),
    }));
  }
  async preserveLegacy(source, backupPath) {
    return this.serial(() =>
      this.transaction(async () => {
        const raw = JSON.stringify(source),
          fingerprint = hash(raw),
          previous = await this.meta("legacyFingerprint");
        if (previous && previous !== fingerprint)
          throw Error("LEGACY_SOURCE_CHANGED");
        if (previous) return;
        const nonempty = Object.values(source).some(
          (rows) => Array.isArray(rows) && rows.length
        );
        await this.setMeta("legacyFingerprint", fingerprint);
        await this.setMeta("legacyBackup", backupPath);
        await this.setMeta("migrationBlocked", nonempty ? "true" : "false");
        if (nonempty)
          await run(this.db, "INSERT INTO recovery_items VALUES (?,?,?,?)", [
            "legacy:" + fingerprint,
            "LEGACY_REVIEW_REQUIRED",
            raw,
            Date.now(),
          ]);
      })
    );
  }
  async legacySource() {
    return this.serial(async () => {
      const fingerprint = await this.meta("legacyFingerprint");
      const row = (
        await all(this.db, "SELECT payload FROM recovery_items WHERE id=?", [
          "legacy:" + fingerprint,
        ])
      )[0];
      return row ? JSON.parse(row.payload) : null;
    });
  }
  async acceptImport(plan) {
    return this.serial(() =>
      this.transaction(async () => {
        if (
          plan.uid !== this.uid ||
          plan.epoch !== (await this.meta("epoch")) ||
          plan.sourceFingerprint !== (await this.meta("legacyFingerprint"))
        )
          throw Error("IMPORT_SCOPE_MISMATCH");
        const deviceId = await this.meta("deviceId");
        for (const item of plan.records) {
          const prior = (
            await all(
              this.db,
              "SELECT * FROM legacy_imports WHERE identity=?",
              [item.identity]
            )
          )[0];
          if (prior) {
            if (
              prior.checksum !== item.checksum ||
              prior.decision !== item.decision ||
              prior.change_id !== item.changeId
            )
              throw Error("IMPORT_PROVENANCE_CHANGED");
            continue;
          }
          if (item.decision === "pending") {
            const request = {
              ...item.mutation,
              epoch: plan.epoch,
              deviceId,
              clientChangeId: item.changeId,
            };
            await run(
              this.db,
              "INSERT INTO outbox(change_id,request) VALUES (?,?)",
              [item.changeId, JSON.stringify(request)]
            );
          }
          await run(this.db, "INSERT INTO legacy_imports VALUES (?,?,?,?)", [
            item.identity,
            item.checksum,
            item.decision,
            item.changeId,
          ]);
        }
        await this.setMeta("migrationBlocked", "false");
        await this.setMeta("importServerFingerprint", plan.serverFingerprint);
        await this.setMeta("importComplete", "true");
        // Keep the original source in recovery storage even after successful import.
        await run(
          this.db,
          "UPDATE recovery_items SET reason='LEGACY_IMPORTED' WHERE id=?",
          ["legacy:" + plan.sourceFingerprint]
        );
        await this.rebase();
      })
    );
  }
  async close() {
    await this.tail;
    await new Promise((resolve, reject) =>
      this.db.close((e) => (e ? reject(e) : resolve()))
    );
  }
}
module.exports = {
  Replica,
  identity,
  optimistic,
  hash,
  validateCursor,
  schema,
};
