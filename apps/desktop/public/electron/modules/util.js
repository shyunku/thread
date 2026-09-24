const Constants = require("./constants");
const ArchCategory = require("../constants/ArchCategory.constants");
const isBuildMode = !process.env.ELECTRON_START_URL;
const PackageJson = require("../../../package.json");

/**
 * @returns {string}
 */
function getServerFinalEndpoint() {
  // Compose publishes the local API on IPv4 only. Electron's Node-side
  // requests may resolve localhost to ::1 and miss an otherwise healthy API.
  const appServerEndpoint = process.env.REACT_APP_APP_SERVER_ENDPOINT?.replace(
    /^(http:\/\/)localhost(?=[:/]|$)/i,
    (_, scheme) => `${scheme}127.0.0.1`
  );
  if (!appServerEndpoint)
    throw new Error("REACT_APP_APP_SERVER_ENDPOINT is not defined");
  const appServerApiVersion = PackageJson?.config?.app_server_api_version;
  if (!appServerApiVersion)
    throw new Error("App server API version is not defined in package.json");
  return `${appServerEndpoint}/${appServerApiVersion}`;
}

/**
 * @returns {string}
 */
function getWebsocketFinalEndpoint() {
  const appServerFinalEndpoint = getServerFinalEndpoint();
  return `${appServerFinalEndpoint.replace(/http/g, "ws")}/websocket/connect`;
}

async function sleep(milli) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, milli);
  });
}

function shorten(obj, maxLength = 100) {
  let str = JSON.stringify(obj);
  if (str.length > maxLength) {
    return str.substring(0, maxLength) + "...";
  }
  return str;
}

function registerSocketLogger(socket) {
  const originalOn = socket.on, originalEmit = socket.emit;
  socket.on = function (topic, callback, ...options) {
    return originalOn.call(socket, topic, function (...args) {
      if (!Constants.SocketSilentTopics.includes(topic)) console.system("SOCKET_RECEIVED");
      return callback.apply(this, args);
    }, ...options);
  };
  socket.emit = function (topic, ...args) {
    if (!Constants.SocketSilentTopics.includes(topic)) console.system("SOCKET_SENT");
    return originalEmit.call(socket, topic, ...args);
  };
}

function getSystemArchCategory() {
  switch (process.platform) {
    case "win32":
      return ArchCategory.Windows;
    case "darwin":
      return ArchCategory.MacOS;
    default:
      return ArchCategory.Unknown;
  }
}

function getSystemArchitectureLabel() {
  switch (process.platform) {
    case "win32":
      return "Windows";
    case "darwin":
      return "MacOS";
    default:
      return "Unknown";
  }
}

function formatFileSize(rawByte, precision = 0) {
  const units = ["B", "kB", "MB", "GB"];
  let unitIndex = 0;

  while (true) {
    if (rawByte < 1024 || unitIndex >= units.length - 1) break;
    rawByte /= 1024;
    unitIndex++;
  }

  const multiFactor = Math.pow(10, precision);
  const factored =
    Math.round((rawByte * multiFactor).toFixed(precision + 1)) / multiFactor;

  return `${Math.floor(factored)}${units[unitIndex]}`;
}

const isProductionMode = () => {
  return isBuildMode;
};

const reqIdTag = (reqId) => {
  if (reqId == null) reqId = "NUL";
  return reqId ? `[${reqId.substr(0, 3)}]` : "";
};

module.exports = {
  registerSocketLogger,
  isProductionMode,
  getSystemArchCategory,
  getSystemArchitectureLabel,
  getServerFinalEndpoint,
  getWebsocketFinalEndpoint,
  formatFileSize,
  sleep,
  shorten,
  reqIdTag,
};
