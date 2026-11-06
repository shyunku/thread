const { reqIdTag } = require("../modules/util");
const { ipcMain } = require("electron");
const IpcRouter = require("../objects/IpcRouter");
const { isTrustedEvent, canRequest, canSubscribe } = require("../modules/windowSecurity");

const COLOR = console.RGB(78, 119, 138);
const TAG = console.wrap("IpcMain", COLOR);

const silentTopics = [];

class IpcService extends IpcRouter {
  constructor() {
    super();

    /** @type {WindowService} */
    this.windowService = null;

    /** @type {DatabaseService} */
    this.databaseService = null;

    /** @type {UserService} */
    this.userService = null;

    // Updater subscriptions must work before the main window IPC is configured.
    this.register("system/subscribe", (event, _reqId, _claimedId, topics) => {
      const role = this.windowService.trustedWindows.get(event.sender.id);
      const list = Array.isArray(topics) ? topics : [topics];
      if (list.length > 128 || list.some(topic => !canSubscribe(role, topic))) return;
      this.addListenersByWebContentsId(list, event.sender.id);
    });
  }

  /**
   * @param group {ServiceGroup}
   */
  inject(group) {
    this.windowService = group.windowService;
    this.databaseService = group.databaseService;
    this.userService = group.userService;
    this.releaseAlertService = group.releaseAlertService;
    this.remindersService = group.remindersService;
    this.vaultWorkspaceService = group.vaultWorkspaceService;
  }

  register(topic, callback, ...arg) {
    const originalCallback = callback;
    callback = async (event, reqId, ...arg) => {
      const windows = this.windowService?.trustedWindows;
      if (!windows || !isTrustedEvent(event, windows, this.windowService.appEntry) ||
          !canRequest(windows.get(event.sender.id), topic)) {
        if (reqId && !event.sender.isDestroyed())
          event.reply(topic, reqId, { success: false, data: { code: "IPC_FORBIDDEN" } });
        return;
      }
      if (!silentTopics.includes(topic) && !topic.startsWith("vault/")) {
        console.system(
          `${TAG} ${console.wrap(
            `<-${reqIdTag(reqId)}--`,
            console.GREEN
          )} ${console.wrap(topic, console.MAGENTA)}`
        );
      }
      try {
        if (await this.vaultWorkspaceService?.interceptApplication(topic, reqId, arg)) return;
        return await originalCallback(event, reqId, ...arg);
      } catch (err) {
        console.error("IPC_HANDLER_FAILED", err);
        return null;
      }
    };
    return ipcMain.on(topic, callback, ...arg);
  }

  silentRegister(topic, ...arg) {
    return this.register(topic, ...arg);
  }

  // send data with success flag
  sender(topic, reqId, success, data = null, ...extra) {
    if (typeof success !== "boolean")
      console.error(
        `[IpcMain]: success flag is not boolean (${console.wrap(
          topic,
          console.MAGENTA
        )})`
      );
    let packagedData = { success, data };
    let sendeeCount = this.broadcast(topic, reqId, packagedData, ...extra);

    if (silentTopics.includes(topic)) return;
    console.system(
      `${TAG} ${console.wrap(
        `--${reqIdTag(reqId)}-${success ? ">" : "X"}`,
        success ? console.CYAN : console.RED
      )} ${console.wrap(topic, console.MAGENTA)} ${console.wrap(
        `(${sendeeCount})`,
        console.BLUE
      )}`
    );
  }

  // send raw data (without success flag)
  emiter(topic, reqId, data) {
    let sendeeCount = this.broadcast(topic, reqId, data);

    if (silentTopics.includes(topic)) return;
    console.system(
      `${TAG} --${reqIdTag(reqId)}-> ${console.wrap(
        topic,
        console.MAGENTA
      )} ${console.wrap(`(${sendeeCount})`, console.BLUE)}`
    );
  }

  silentSender(topic, success, data) {
    let packagedData = { success, data };
    this.broadcast(topic, null, packagedData);
  }
}

module.exports = IpcService;
