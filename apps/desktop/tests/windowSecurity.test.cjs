const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { EventEmitter } = require("events");
const policy = require("../public/electron/modules/windowSecurity");
const contract = require("../public/electron/modules/preload");
const source = fs.readFileSync(path.join(__dirname, "../public/electron/modules/preload.js"), "utf8");

function preload(mainFrame = true) {
  const ipc = new EventEmitter(), sent = [], exposed = {};
  ipc.send = (...args) => sent.push(args);
  vm.runInNewContext(source, {
    process: { type: "renderer", isMainFrame: mainFrame,
      env: { NODE_ENV: "production", SYNTHETIC_SECRET: "must-not-cross" } },
    require: name => {
      assert.equal(name, "electron");
      return { ipcRenderer: ipc, contextBridge: {
        exposeInMainWorld: (key, value) => { exposed[key] = value; },
      }};
    },
  });
  return { ipc, sent, exposed };
}

test("preload exposes fixed capabilities, no Node, remote, environment or IPC event", () => {
  const { ipc, sent, exposed } = preload();
  assert.deepEqual(Object.keys(exposed), ["thread"]);
  const bridge = exposed.thread;
  assert.equal(bridge.isDevelopment, false);
  assert.equal(bridge.env, undefined);
  assert.equal(bridge.send, undefined);
  assert.equal(bridge.requests.__callback__, undefined);
  assert.equal(bridge.requests["ELECTRON_BROWSER_REQUIRE"], undefined);
  bridge.requests["task/addTask"]("request", { title: "fixture" });
  assert.equal(sent[0][0], "task/addTask");
  const messages = [];
  const stop = bridge.listen("sync-v2/state", (...args) => messages.push(args));
  ipc.emit("sync-v2/state", { sender: { privileged: true } }, null, { success: true });
  assert.deepEqual(messages, [[null, { success: true }]]);
  stop();
  ipc.emit("sync-v2/state", {}, null, { success: true });
  assert.equal(messages.length, 1);
  assert.throws(() => bridge.listen("ELECTRON_BROWSER_REQUIRE", () => {}));
  assert.deepEqual(Object.keys(preload(false).exposed), []);
});

test("app URL validation rejects sibling file, wrong host, query and subframes", () => {
  const entry = "file:///C:/Thread/build/index.html";
  const mainFrame = { url: entry + "#/login" };
  const sender = { id: 7, isDestroyed: () => false, mainFrame };
  const windows = new Map([[7, "main"]]);
  assert.equal(policy.isTrustedEvent({ sender, senderFrame: mainFrame }, windows, entry), true);
  assert.equal(policy.isTrustedEvent({ sender, senderFrame: { url: mainFrame.url } }, windows, entry), false);
  assert.equal(policy.isTrustedEvent({ sender, senderFrame: mainFrame }, new Map(), entry), false);
  for (const url of ["file:///C:/Thread/build/evil.html", entry + "?evil=1",
    "https://evil.invalid/#/login", "data:text/html,fixture"])
    assert.equal(policy.isAppURL(url, entry), false);
  assert.equal(policy.isAppURL("http://localhost:9300/#/login", "http://localhost:9300"), true);
  assert.equal(policy.isAppURL("http://localhost.evil.invalid:9300/", "http://localhost:9300"), false);
});

test("window roles cannot subscribe to auth data or issue other-window commands", () => {
  assert.equal(policy.canRequest("main", "task/addTask"), true);
  assert.equal(policy.canRequest("updater", "task/addTask"), false);
  assert.equal(policy.canRequest("popup", "auth/loadAuthInfoSync"), false);
  assert.equal(policy.canRequest("updater", "update_check@continue"), true);
  assert.equal(policy.canRequest("main", "__callback__"), false);
  assert.equal(policy.canRequest(undefined, "system/close_window"), false);
  assert.equal(policy.canSubscribe(undefined, "__window_param__"), false);
  assert.equal(policy.canSubscribe("updater", "auth/tokenUpdated"), false);
  assert.equal(policy.canSubscribe("updater", "release_download@state"), true);
  assert.equal(policy.canSubscribe("main", "sync-v2/state"), true);
  assert.equal(policy.canSubscribe("main", "arbitrary/channel"), false);
});

test("renderer window options cannot override preload, sandbox, parent or URL", () => {
  assert.deepEqual(policy.rendererWindowOptions({
    width: 500, height: -1, parent: 42, preload: "/evil",
    webPreferences: { nodeIntegration: true, sandbox: false }, resizable: true,
  }), { width: 500, resizable: true });
  const prefs = policy.securePreferences();
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.webviewTag, false);
  assert.equal(policy.validRoute("/settings"), true);
  assert.equal(policy.validRoute("https://evil.invalid"), false);
});

test("only exact OAuth launch URL is accepted; production CSP forbids eval", () => {
  const api = "https://api.threadapp.kr/v1";
  assert.equal(policy.canOpenOAuth(api + "/google_auth/login", api), true);
  for (const url of [api + "/google_auth/login?next=evil", "javascript:alert(1)",
    "https://api.threadapp.kr.evil.invalid/v1/google_auth/login",
    "https://user@api.threadapp.kr/v1/google_auth/login"])
    assert.equal(policy.canOpenOAuth(url, api), false);
  const csp = policy.contentSecurityPolicy("file:///Thread/index.html", api);
  assert.ok(csp.includes("script-src 'self';"));
  assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(csp.includes("connect-src 'self' https://api.threadapp.kr"));
  const dev = policy.contentSecurityPolicy("http://localhost:9300", api, true);
  assert.ok(dev.includes("ws://localhost:9300"));
});

test("all active renderer event subscriptions exist in the bridge contract", () => {
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  for (const file of walk(path.join(__dirname, "../src"))) {
    if (!file.endsWith(".js") || file.endsWith(".test.js")) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/IpcSender\.(?:onAll|on|once)\(\s*"([^"]+)"/g))
      assert.ok(contract.canReceive(match[1]), file + ": " + match[1]);
  }
});
