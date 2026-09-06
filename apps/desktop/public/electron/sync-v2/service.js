const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sqlite3 = require("sqlite3");
const axios = require("axios");
const WebSocket = require("ws");
const { Replica, identity } = require("./replica");
const { classify, planImport } = require("./legacyImport");
const { getUserDataPath } = require("../modules/filesystem");
const { getServerFinalEndpoint } = require("../modules/util");

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
          a.tid || crypto.randomUUID(),
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
        a.sid || crypto.randomUUID(),
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
        a.cid || crypto.randomUUID(),
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
class SyncV2Service {
  constructor() {
    this.sessions = new Map();
    this.opening = new Map();
  }
  inject(group) {
    this.group = group;
  }
  file(uid) {
    return path.join(
      getUserDataPath(),
      "datafiles",
      "sync-v2",
      "user-" + encodeURIComponent(uid) + ".sqlite3"
    );
  }
  active(uid) {
    return this.sessions.has(uid);
  }
  async restore(uid, create = false) {
    if (this.sessions.has(uid)) return this.sessions.get(uid);
    if (this.opening.has(uid)) return this.opening.get(uid);
    const file = this.file(uid);
    if (!create && !fs.existsSync(file)) return null;
    const opening = (async () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const replica = await Replica.open(file, uid);
      const s = {
        uid,
        replica,
        running: false,
        connected: false,
        generation: 0,
        socket: null,
        timer: null,
      };
      this.sessions.set(uid, s);
      await this.publish(s);
      return s;
    })().finally(() => this.opening.delete(uid));
    this.opening.set(uid, opening);
    return opening;
  }
  async preserveLegacy(s) {
    if (await s.replica.meta("legacyFingerprint")) return;
    const legacy = await this.group.databaseService.getUserDatabaseContext(
      s.uid
    );
    const backup = path.join(
      path.dirname(this.file(s.uid)),
      "legacy-" + crypto.randomUUID() + ".sqlite3"
    );
    await new Promise((resolve, reject) =>
      legacy.db.run("VACUUM INTO ?", [backup], (err) =>
        err ? reject(err) : resolve()
      )
    );
    const db = await new Promise((resolve, reject) => {
      const d = new sqlite3.Database(backup, sqlite3.OPEN_READONLY, (err) =>
        err ? reject(err) : resolve(d)
      );
    });
    const source = {};
    try {
      for (const table of [
        "tasks",
        "subtasks",
        "categories",
        "tasks_categories",
        "transactions",
      ]) {
        source[table] = await new Promise((resolve, reject) =>
          db.all("SELECT * FROM " + table + " ORDER BY rowid", (err, rows) =>
            err ? reject(err) : resolve(rows)
          )
        );
      }
    } finally {
      await new Promise((resolve) => db.close(resolve));
    }
    await s.replica.preserveLegacy(source, backup);
  }
  async activate(uid, token, caps, renewToken) {
    const s = await this.restore(uid, true);
    this.stop(s);
    const generation = s.generation;
    await this.preserveLegacy(s);
    const legacy = this.group.syncerService.userSyncerContexts.get(uid);
    if (legacy) await legacy.setEventLock(true);
    const base =
      getServerFinalEndpoint().replace(/\/v[0-9]+\/?$/, "") + "/v2/sync";
    s.request = async (route, body) => {
      try {
        const send = () =>
          axios({
            url: base + route,
            method: body === undefined ? "GET" : "POST",
            data: body,
            timeout: 30000,
            headers: { Authorization: "Bearer " + token },
          });
        let r;
        try {
          r = await send();
        } catch (e) {
          if (e.response?.status !== 401 || !renewToken) throw e;
          token = await renewToken(token);
          r = await send();
        }
        if (s.generation !== generation) throw Error("SESSION_CHANGED");
        return r.data;
      } catch (e) {
        throw Error(
          e.response?.data?.code ||
            (e.response?.status === 401
              ? "UNAUTHORIZED"
              : e.message === "SESSION_CHANGED"
              ? "SESSION_CHANGED"
              : "SYNC_UNAVAILABLE")
        );
      }
    };
    s.epoch = caps.epoch;
    const run = async () => {
      if (s.running || s.generation !== generation) return;
      s.running = true;
      try {
        caps = await s.request("/capabilities");
        if (caps.mode !== "v2" || caps.protocolVersion !== 2)
          throw Error("ACCOUNT_MODE_REGRESSION");
        s.epoch = caps.epoch;
        if (!caps.enabled) throw Error("SYNC_DISABLED");
        if (
          !(await s.replica.meta("cursor")) ||
          (await s.replica.meta("epoch")) !== s.epoch
        )
          await this.snapshot(s);
        if ((await s.replica.meta("migrationBlocked")) === "true") {
          const source = await s.replica.legacySource();
          const proof = await s.request(
            "/legacy-proof?epoch=" + encodeURIComponent(s.epoch)
          );
          const { base } = classify(source, proof, uid);
          const baseProof = await s.request(
            "/legacy-proof?epoch=" +
              encodeURIComponent(s.epoch) +
              "&base=" +
              encodeURIComponent(base)
          );
          await s.replica.acceptImport(
            planImport(source, proof, baseProof, uid)
          );
        }
        await s.request("/devices", {
          epoch: s.epoch,
          deviceId: await s.replica.meta("deviceId"),
        });
        await this.pull(s);
        if ((await s.replica.meta("migrationBlocked")) !== "true") {
          for (let i = 0; i < 100; i++) {
            const request = await s.replica.next();
            if (!request) break;
            const { epoch, deviceId, ...mutation } = request;
            const data = await s.request("/push", {
              protocolVersion: 2,
              epoch,
              deviceId,
              mutations: [mutation],
            });
            const result = data.results?.[0];
            if (!result || !["accepted", "rejected"].includes(result.status))
              throw Error(result?.code || "PUSH_RETRY");
            await s.replica.acknowledge(request.clientChangeId, result);
            if (result.conflictFields?.length)
              this.group.ipcService.sender("sync-v2/error", null, true, {
                uid,
                code: "FIELD_CONFLICT: " + result.conflictFields.join(", "),
              });
            await this.pull(s);
            if (result.status === "rejected") break;
          }
        }
        s.connected = true;
        s.error = null;
        if (!s.socket) {
          const ws = new WebSocket(
            base.replace(/^http/, "ws") +
              "/connect?epoch=" +
              encodeURIComponent(s.epoch),
            { headers: { Authorization: "Bearer " + token } }
          );
          s.socket = ws;
          ws.on("message", () => {
            void run();
          });
          ws.on("error", () => ws.close());
          ws.on("close", () => {
            if (s.socket === ws) s.socket = null;
          });
        }
      } catch (e) {
        s.connected = false;
        s.error = e.message;
      } finally {
        s.running = false;
        if (s.generation === generation) await this.publish(s);
      }
    };
    s.run = run;
    s.timer = setInterval(() => {
      void run();
    }, 15000);
    s.timer.unref?.();
    await run();
  }
  async snapshot(s) {
    const snapshot = await s.request("/snapshots", { epoch: s.epoch });
    if (
      !Number.isInteger(snapshot.pageCount) ||
      snapshot.pageCount < 1 ||
      snapshot.pageCount > 1024
    )
      throw Error("INVALID_SNAPSHOT");
    const pages = [];
    for (let i = 0; i < snapshot.pageCount; i++)
      pages.push(
        await s.request(
          "/snapshots/" +
            encodeURIComponent(snapshot.snapshotId) +
            "/pages/" +
            i +
            "?epoch=" +
            encodeURIComponent(s.epoch)
        )
      );
    await s.replica.installSnapshot(snapshot, pages);
  }
  async pull(s) {
    let until = "";
    for (let i = 0; i < 10000; i++) {
      let page;
      try {
        page = await s.request(
          "/changes?epoch=" +
            encodeURIComponent(s.epoch) +
            "&after=" +
            encodeURIComponent(await s.replica.meta("cursor")) +
            (until ? "&until=" + encodeURIComponent(until) : "")
        );
      } catch (e) {
        if (["RESET_REQUIRED", "INVALID_CURSOR", "LOG_GAP"].includes(e.message))
          await this.snapshot(s);
        throw e;
      }
      if (until && until !== page.until) throw Error("HIGHWATER_CHANGED");
      await s.replica.applyPage(page);
      if (!page.hasMore) return;
      until = page.until;
    }
    throw Error("PULL_LIMIT");
  }
  async status(s) {
    const view = await s.replica.view();
    const blocked = (await s.replica.meta("migrationBlocked")) === "true";
    return {
      uid: s.uid,
      ready: !!view.epoch && !blocked,
      connected: s.connected,
      syncing: !!s.running,
      canSync: typeof s.run === "function",
      seq: view.seq,
      pending: view.pending.length,
      recovery: view.recovery,
      error: blocked ? "LEGACY_REVIEW_REQUIRED" : s.error,
      detail: blocked ? s.error : null,
    };
  }
  async settingsStatus(retry = false) {
    const uid = this.group.userService.getCurrent();
    const s = this.sessions.get(uid);
    if (!s) return { uid, ready: false, connected: false, canSync: false, pending: null, seq: null };
    if (retry && s.run) await s.run();
    return this.status(s);
  }
  async publish(s) {
    if (this.group.userService.getCurrent() !== s.uid) return;
    const status = await this.status(s);
    if (this.group.userService.getCurrent() !== s.uid) return;
    this.group.ipcService.sender("sync-v2/status", null, true, status);
    const view = await s.replica.view();
    const blocked = (await s.replica.meta("migrationBlocked")) === "true";
    if (view.epoch && !blocked)
      this.group.ipcService.sender("sync-v2/state", null, true, {
        uid: s.uid,
        ...entityLists(view),
      });
  }
  stop(s) {
    s.generation++;
    clearInterval(s.timer);
    s.timer = null;
    s.socket?.close();
    s.socket = null;
    s.connected = false;
  }
  async intercept(topic, reqId, args) {
    const uid = this.group.userService.getCurrent();
    const s = this.sessions.get(uid);
    if (!s) return false;
    const ipc = this.group.ipcService;
    if (topic === "socket/disconnect") {
      this.stop(s);
      await this.publish(s);
      ipc.sender(topic, reqId, true);
      return true;
    }
    if (mutationTopics.has(topic)) {
      try {
        const id = await s.replica.enqueue(
          command(topic, args, await s.replica.view())
        );
        ipc.sender(topic, reqId, true, { syncV2Ack: true, clientChangeId: id });
        await this.publish(s);
        void s.run?.();
      } catch (e) {
        ipc.sender(topic, reqId, false, { syncV2Ack: true, code: e.message });
        ipc.sender("sync-v2/error", null, true, { uid, code: e.message });
      }
      return true;
    }
    if (
      [
        "system/migrateLegacyDatabase",
        "system/truncateLegacyDatabase",
        "system/mismatchTxAcceptTheirs",
        "system/mismatchTxAcceptMine",
        "system/initializeState",
        "system/clearStatePermanently",
      ].includes(topic)
    ) {
      ipc.sender(topic, reqId, false, "V2_LEGACY_ACTION_BLOCKED");
      return true;
    }
    if (topic === "system/isLegacyMigrationAvailable") {
      ipc.sender(topic, reqId, true, 0);
      return true;
    }
    if (
      ["system/migrateCheckDoneSignal", "system/stateListenReady"].includes(
        topic
      )
    ) {
      await this.publish(s);
      ipc.sender(topic, reqId, true);
      return true;
    }
    if (
      ["system/localLastBlockNumber", "system/remoteLastBlockNumber"].includes(
        topic
      )
    ) {
      ipc.sender(topic, reqId, true, 0);
      return true;
    }
    if ((await s.replica.meta("migrationBlocked")) === "true") return false;
    const reads = {
      "task/getAllTaskList": "tasks",
      "task/getAllSubtaskList": "subtasks",
      "category/getCategoryList": "categories",
      "tasks_categories/getTasksCategoriesList": "relations",
    };
    if (reads[topic]) {
      ipc.sender(
        topic,
        reqId,
        true,
        entityLists(await s.replica.view())[reads[topic]]
      );
      return true;
    }
    if (topic === "category/getCategoryTasks") {
      ipc.sender(
        topic,
        reqId,
        true,
        entityLists(await s.replica.view()).relations.filter(
          (r) => r.cid === args[0]
        )
      );
      return true;
    }
    if (topic === "system/isDatabaseClear") {
      ipc.sender(
        topic,
        reqId,
        true,
        entityLists(await s.replica.view()).tasks.length === 0
      );
      return true;
    }
    if (topic === "system/lastTxUpdateTime") {
      ipc.sender(
        topic,
        reqId,
        true,
        (await s.replica.view()).rows.reduce(
          (latest, r) => Math.max(latest, r.fields.updated_at || 0),
          0
        )
      );
      return true;
    }
    return false;
  }
}
module.exports = { SyncV2Service, command, entityLists, mutationTopics };
