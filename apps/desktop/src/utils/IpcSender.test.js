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
    window: { require: (name) => name === "electron" ? { ipcRenderer } : {
      getCurrentWebContents: () => ({ id: 1 }),
      getCurrentWindow: () => ({ id: 1 }),
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
  ipcRenderer.emit("sync-v2/status", {}, null, { success: true, data: { seq: "2" } });
  expect(root).toHaveBeenCalledTimes(1);
  expect(settings).not.toHaveBeenCalled();
  sender.offAll("sync-v2/status");
  expect(ipcRenderer.listenerCount("sync-v2/status")).toBe(0);
});
