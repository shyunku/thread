// Synthetic integration only: no real env, app DB, login, or external network.
// Run: pnpm --dir apps/desktop exec electron tests/rendererIsolation.smoke.cjs
const { app, BrowserWindow } = require("electron");
const assert = require("assert").strict;
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { once } = require("events");

assert.ok(app, "Run as Electron with ELECTRON_RUN_AS_NODE unset");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "thread-isolation-"));
app.setPath("userData", temp);
app.setPath("sessionData", temp);
console.wrap = value => value;
console.RGB = () => "";
console.shorten = () => "<fixture>";
console.system = () => {};
process.env.NODE_ENV = "production";
let server, service;
const timeout = setTimeout(() => { console.error("Isolation smoke timed out"); finish(1); }, 25000);

function finish(code) {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server?.close();
  app.once("quit", () => {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
  });
  app.exit(code);
}

(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Synthetic isolation fixture</title><body>Fixture only</body>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  process.env.ELECTRON_START_URL = origin;
  process.env.REACT_APP_APP_SERVER_ENDPOINT = origin;
  await app.whenReady();
  const WindowService = require("../public/electron/service/window.service");
  const IpcService = require("../public/electron/service/ipc.service");
  const ipc = new IpcService();
  service = new WindowService();
  service.ipcService = ipc;
  ipc.windowService = service;
  ipc.syncV2Service = { intercept: async () => false };
  ipc.register("task/addTask", (event, id, body) => {
    assert.equal(body.title, "synthetic task");
    ipc.sender("task/addTask", id, true, { accepted: true });
  });

  const main = service.createMainWindow();
  service.mainWindow = main;
  main.show = () => {};
  await once(main.webContents, "did-finish-load");
  const globals = await main.webContents.executeJavaScript(
    "({node:typeof window.require, process:typeof window.process, env:typeof window.env, bridge:typeof window.thread, dev:window.thread.isDevelopment})");
  assert.deepEqual(globals, { node: "undefined", process: "undefined", env: "undefined", bridge: "object", dev: false });
  assert.equal(await main.webContents.executeJavaScript(
    "window.inlineExecuted=false; var injected=document.createElement('script'); injected.textContent='window.inlineExecuted=true'; document.body.appendChild(injected); window.inlineExecuted"), false);
  assert.equal(await main.webContents.executeJavaScript(
    'window.open("' + origin + '/untrusted") === null', true), true);
  const result = await main.webContents.executeJavaScript(`new Promise(resolve => {
    window.thread.requests["system/subscribe"](null, 99999, "task/addTask");
    const stop = window.thread.listen("task/addTask", (id, body) => { stop(); resolve(body); });
    window.thread.requests["task/addTask"]("fixture-request", { title:"synthetic task" });
  })`);
  assert.equal(result.success, true);
  assert.equal(result.data.accepted, true);
  assert.deepEqual(ipc.listenerMap["task/addTask"], [main.webContents.id]);

  const childCreated = once(main.webContents, "did-create-window");
  await main.webContents.executeJavaScript(
    'window.fixtureChild = window.open("' + origin + '/v1/google_auth/login", "fixture"); true', true);
  const [child] = await childCreated;
  child.hide();
  if (child.webContents.isLoading()) await once(child.webContents, "did-finish-load");
  assert.equal(await child.webContents.executeJavaScript("typeof window.thread"), "undefined");
  assert.equal(await child.webContents.executeJavaScript("typeof window.require"), "undefined");
  assert.equal(service.trustedWindows.has(child.webContents.id), false);
  await main.webContents.executeJavaScript("window.fixtureMessage = new Promise(resolve => window.addEventListener('message', e => resolve(e.data), {once:true})); true");
  await child.webContents.executeJavaScript("window.opener.postMessage('fixture-oauth-result', '*'); true");
  assert.equal(await main.webContents.executeJavaScript("window.fixtureMessage"), "fixture-oauth-result");

  const updater = service.invokeWindow("/update-checker", { show:false }, null, null, "updater");
  updater.show = () => {};
  await once(updater.webContents, "did-finish-load");
  const denied = await updater.webContents.executeJavaScript(`new Promise(resolve => {
    window.thread.listen("task/addTask", (_id, data) => resolve(data));
    window.thread.requests["task/addTask"]("forbidden", {title:"synthetic task"});
  })`);
  assert.equal(denied.data.code, "IPC_FORBIDDEN");
  const notice = updater.webContents.executeJavaScript(`new Promise(resolve => {
    window.thread.listen("release_download@state", (...args) => resolve(args));
    window.thread.requests["system/subscribe"](null, 99999, "release_download@state");
  })`);
  // Wait for the subscription IPC before broadcasting a fixture progress event.
  for (let attempt = 0; attempt < 100 && !ipc.listenerMap["release_download@state"]; attempt++)
    await new Promise(resolve => setTimeout(resolve, 10));
  ipc.silentSender("release_download@state", true, { percentage: 50 });
  const progress = await notice;
  assert.equal(progress[0], null);
  assert.equal(progress[1].success, true);
  assert.equal(progress[1].data.percentage, 50);
  assert.deepEqual(ipc.listenerMap["release_download@state"], [updater.webContents.id]);

  console.log("PASS: real sandboxed preload, IPC ownership, updater roles, OAuth without bridge, postMessage");
  finish(0);
})().catch(error => { console.error(error); finish(1); });
