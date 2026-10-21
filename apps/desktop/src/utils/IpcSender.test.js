import fs from "fs";
import path from "path";
import vm from "vm";
import { EventEmitter } from "events";

test("removing a settings listener preserves the root listener on the same topic", () => {
  const ipcRenderer = new EventEmitter();
  ipcRenderer.send = jest.fn();
  const context = {
    module: { exports: {} },
    uuid: { v4: () => "request" },
    colorize: { yellow: (v) => v, cyan: (v) => v, magenta: (v) => v },
    console: { debug: jest.fn(), warn: jest.fn() },
    window: { thread: {
      requests: {
        "system/subscribe": (...args) => ipcRenderer.send("system/subscribe", ...args),
      },
      listen: (topic, callback) => {
        const handler = (_event, ...args) => callback(...args);
        ipcRenderer.on(topic, handler);
        return () => ipcRenderer.removeListener(topic, handler);
      },
    } },
  };
  const source = fs.readFileSync(path.resolve("src/utils/IpcSender.js"), "utf8")
    .replace(/^import .*;\r?$/gm, "")
    .replace("export default IpcSender;", "module.exports = IpcSender;");
  vm.runInNewContext(source, context);
  const sender = context.module.exports;
  const root = jest.fn(), settings = jest.fn();
  sender.onAll("sync-v2/status", root);
  const listener = sender.onAll("sync-v2/status", settings);
  sender.off("sync-v2/status", listener);
  ipcRenderer.emit("sync-v2/status", {}, null, { success: true, data: { seq: "2", title: "SYNTHETIC_PRIVATE" } });
  expect(JSON.stringify(context.console.debug.mock.calls)).not.toContain("SYNTHETIC_PRIVATE");
  expect(root).toHaveBeenCalledTimes(1);
  expect(settings).not.toHaveBeenCalled();
  sender.offAll("sync-v2/status");
  expect(ipcRenderer.listenerCount("sync-v2/status")).toBe(0);
});

test("#102 helpers send the composed topics and report only this account's vault lock", () => {
  const ipcRenderer = new EventEmitter();
  const sent = [];
  const requests = new Proxy({}, {
    has: () => true,
    get: (_target, topic) => (...args) => sent.push([topic, ...args]),
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: () => {} }),
  });
  const context = {
    module: { exports: {} },
    uuid: { v4: () => "request" },
    colorize: { yellow: (v) => v, cyan: (v) => v, magenta: (v) => v },
    console: { debug: jest.fn(), warn: jest.fn() },
    window: { thread: {
      requests,
      listen: (topic, callback) => {
        const handler = (_event, ...args) => callback(...args);
        ipcRenderer.on(topic, handler);
        return () => ipcRenderer.removeListener(topic, handler);
      },
    } },
  };
  const source = fs.readFileSync(path.resolve("src/utils/IpcSender.js"), "utf8")
    .replace(/^import .*;\r?$/gm, "")
    .replace("export default IpcSender;", "module.exports = IpcSender;");
  vm.runInNewContext(source, context);
  const sender = context.module.exports;
  const calls = () => sent.filter(([topic]) => topic !== "system/subscribe").map(([topic, , ...args]) => [topic, ...args]);
  sender.req.task.duplicateTask("t1", "copy");
  sender.req.task.duplicateTask("t2");
  sender.req.category.deleteCategoryInUse("c1");
  sender.req.category.updateCategoryOrder("c1", "c2", true);
  sender.vault.verifyUser();
  sender.vault.verifyUser({ method: "password", password: "synthetic" });
  expect(calls()).toEqual([
    ["task/duplicateTask", "t1", { tid: "copy" }],
    ["task/duplicateTask", "t2", undefined],
    ["category/deleteCategoryInUse", "c1"],
    ["category/updateCategoryOrder", "c1", "c2", true],
    ["vault/verifyUser", {}],
    ["vault/verifyUser", { method: "password", password: "synthetic" }],
  ]);
  expect(sender.req.category.checkCategoryPassword).toBeUndefined();
  const locked = jest.fn();
  const stop = sender.vault.onLocked("me", locked);
  ipcRenderer.emit("vault/status", {}, null, { success: true, data: { uid: "other", phase: "LOCKED" } });
  ipcRenderer.emit("vault/status", {}, null, { success: true, data: { uid: "me", phase: "UNLOCKED" } });
  ipcRenderer.emit("vault/status", {}, null, { success: true, data: { uid: "me", phase: "LOCKED" } });
  expect(locked).toHaveBeenCalledTimes(1);
  stop();
  ipcRenderer.emit("vault/status", {}, null, { success: true, data: { uid: "me", phase: "LOCKED" } });
  expect(locked).toHaveBeenCalledTimes(1);
});

test("every IpcSender call in the renderer names a function IpcSender has", () => {
  // Catches a call left behind when a request is removed (e.g. #102 dropped
  // category/checkCategoryPassword); the old call would throw a TypeError at runtime.
  const context = {
    module: { exports: {} },
    uuid: { v4: () => "request" },
    colorize: { yellow: (v) => v, cyan: (v) => v, magenta: (v) => v },
    console: { debug: jest.fn(), warn: jest.fn() },
    window: { thread: { requests: {}, listen: () => () => {} } },
  };
  const source = fs.readFileSync(path.resolve("src/utils/IpcSender.js"), "utf8")
    .replace(/^import .*;\r?$/gm, "")
    .replace("export default IpcSender;", "module.exports = IpcSender;");
  vm.runInNewContext(source, context);
  const sender = context.module.exports;
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) files.push(file);
    }
  };
  walk(path.resolve("src"));
  const missing = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const [, chain] of text.matchAll(/\bIpcSender((?:\.[A-Za-z_$][\w$]*)+)\s*\(/g)) {
      const value = chain.slice(1).split(".").reduce((node, key) => node?.[key], sender);
      if (typeof value !== "function") missing.push(`${path.relative(path.resolve("src"), file)}: IpcSender${chain}`);
    }
  }
  expect(files.length).toBeGreaterThan(10);
  expect(missing).toEqual([]);
});
