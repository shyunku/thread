const path = require("path");
const { pathToFileURL } = require("url");
const { REQUEST_TOPICS, UPDATE_EVENTS, canReceive } = require("./preload");

function appEntryURL(devURL) {
  return devURL || pathToFileURL(path.resolve(__dirname, "../../../build/index.html")).href;
}

function isAppURL(candidate, entry) {
  try {
    const actual = new URL(candidate), expected = new URL(entry);
    actual.hash = ""; expected.hash = "";
    // Only the exact application document, with hash-router navigation allowed.
    return actual.href === expected.href;
  } catch { return false; }
}

function securePreferences() {
  return {
    nodeIntegration: false, nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false, enableRemoteModule: false,
    contextIsolation: true, sandbox: true, webSecurity: true,
    webviewTag: false, spellcheck: false, backgroundThrottling: false,
    preload: path.join(__dirname, "preload.js"),
  };
}

function secureOAuthPreferences() {
  return {
    ...securePreferences(),
    preload: path.join(__dirname, "oauthPreload.js"),
    additionalArguments: [],
  };
}

function isTrustedEvent(event, windows, entry) {
  const sender = event?.sender;
  return !!sender && !sender.isDestroyed() && windows.has(sender.id) &&
    event.senderFrame === sender.mainFrame && isAppURL(event.senderFrame?.url, entry);
}

function canRequest(role, topic) {
  if (!REQUEST_TOPICS.includes(topic)) return false;
  if (role === "main") return topic !== "update_check@continue";
  if (topic === "system/subscribe") return !!role;
  if (role === "updater") return topic === "update_check@continue";
  return role === "popup" && ["system/close_window", "system/computer_idle_time",
    "system/inner-modal", "system/close-inner-modal"].includes(topic);
}

function canSubscribe(role, topic) {
  if (!canReceive(topic)) return false;
  if (role === "main") return true;
  if (role === "updater") return UPDATE_EVENTS.includes(topic);
  return role === "popup" && ["__window_param__", "inner-modal", "close-inner-modal"].includes(topic);
}

function rendererWindowOptions(input = {}) {
  const options = {};
  for (const key of ["width", "height", "minWidth", "minHeight"]) {
    if (Number.isInteger(input[key]) && input[key] >= 100 && input[key] <= 4096)
      options[key] = input[key];
  }
  for (const key of ["resizable", "alwaysOnTop"])
    if (typeof input[key] === "boolean") options[key] = input[key];
  return options;
}

function validRoute(route) {
  return typeof route === "string" && /^\/[a-zA-Z0-9/_-]*$/.test(route);
}

function canOpenOAuth(candidate, apiEntry) {
  try {
    const actual = new URL(candidate), expected = new URL(apiEntry + "/google_auth/login");
    return ["http:", "https:"].includes(actual.protocol) &&
      !actual.username && !actual.password && actual.href === expected.href;
  } catch { return false; }
}

function contentSecurityPolicy(entry, apiEntry, development = false) {
  const connections = new Set(["'self'"]);
  for (const raw of [apiEntry, development ? entry : null]) {
    if (!raw) continue;
    const target = new URL(raw);
    if (!["http:", "https:"].includes(target.protocol)) continue;
    connections.add(target.origin);
    if (development && raw === entry) {
      target.protocol = target.protocol === "http:" ? "ws:" : "wss:";
      connections.add(target.origin);
    }
  }
  return [
    "default-src 'self'", "base-uri 'none'", "object-src 'none'",
    "frame-src 'none'", "form-action 'none'",
    "script-src 'self'" + (development ? " 'unsafe-eval'" : ""),
    "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
    "img-src 'self' data: https:", "connect-src " + [...connections].join(" "),
  ].join("; ");
}

module.exports = {
  appEntryURL, isAppURL, securePreferences, isTrustedEvent,
  canRequest, canSubscribe, rendererWindowOptions, validRoute, canOpenOAuth,
  contentSecurityPolicy, secureOAuthPreferences,
};
