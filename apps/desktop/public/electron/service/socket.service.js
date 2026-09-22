// TODO :: refactor this file
// to make this as service class

const SocketIoClient = require("socket.io-client");
const util = require("./../modules/util");
const CompareVersion = require("compare-versions");
const PackageJson = require("../../../package.json");

let Ipc;
const connectUrl = process.env.SOCKET_SERVER_URL;

// send authentication refresh signal
/* ---------------------------------------- Pre-Execution ---------------------------------------- */
let socket = SocketIoClient(connectUrl, {
  transports: ["websocket"],
  allowUpgrades: false,
});

util.registerSocketLogger(socket, console.bCYAN + console.BLACK);

socket.token = null;
socket.email = null;

/* ---------------------------------------- Default ---------------------------------------- */
console.system("SOCKET_SERVICE_SYSTEM");

socket.on("connect", () => {
  console.system("SOCKET_SERVICE_SYSTEM");
  if (socket.token && socket.email) {
    // auto reconnect with authentication
    let { email, token } = socket;
    socket.emit("authen", { email, token });
  }
});

socket.on("error", (err) => {
  console.error("SOCKET_SERVICE_ERROR");
});

socket.on("disconnect", (reason) => {
  console.info("SOCKET_SERVICE_INFO");
});

socket.on("connect_failed", (reason) => {
  console.error(`Socket connection failed`);
});

/* ---------------------------------------- System ---------------------------------------- */
socket.on("alert:/version/new", (data) => {
  const { version } = data.data;
  const currentVersion = PackageJson.version;

  const newVersionValid = CompareVersion.validate(version);
  const curVersionValid = CompareVersion.validate(currentVersion);

  if (!newVersionValid) {
    console.error("SOCKET_SERVICE_ERROR");
    return;
  }

  if (!curVersionValid) {
    console.error("SOCKET_SERVICE_ERROR");
    return;
  }

  const isHigher = CompareVersion.compare(version, currentVersion, ">");
  if (isHigher) {
    Ipc.fastSender("alert:/version/new", data);
  }
});

/* ---------------------------------------- Custom ---------------------------------------- */

module.exports = {
  socket,
  setIpc: (Ipc_) => {
    Ipc = Ipc_;
  },
};
