const { BrowserWindow, screen } = require("electron");
const WindowPropertyFactory = require("../util/WindowPropertyFactory");
const { WindowType } = require("../modules/constants");
const {
  appEntryURL, isAppURL, securePreferences, canOpenOAuth, validRoute,
  contentSecurityPolicy, secureOAuthPreferences,
} = require("../modules/windowSecurity");
const { getServerFinalEndpoint } = require("../modules/util");
const AlertPopupConstants = require("../constants/AlertPopup.constants");
const lodash = require("lodash");

const urlPrefix = appEntryURL(process.env.ELECTRON_START_URL);

class WindowService {
  constructor(ipcService) {
    this.trustedWindows = new Map();
    this.appEntry = urlPrefix;
    this.securedSessions = new WeakSet();
    /** @type {IpcService} */
    this.ipcService = null;
    this.mainWindow = null;
    /** @type {Tray} */
    this.tray = null;
  }

  /**
   * @param serviceGroup {ServiceGroup}
   */
  inject(serviceGroup) {
    this.ipcService = serviceGroup.ipcService;
  }

  initialize() {
    this.mainWindow = this.createMainWindow();
    this.mainWindow.once("ready-to-show", () => {
      this.mainWindow.show();
      this.mainWindow.focus();
    });
    this.setWindowStateChangeListener(this.mainWindow);
  }

  getMainWindow() {
    return this.mainWindow;
  }

  invokeWindow(url, windowProperty = {}, parameter, shown, role = "popup") {
    if (!validRoute(url)) throw new Error("INVALID_WINDOW_ROUTE");
    // Security preferences cannot be overridden by modal options or callers.
    let window = new BrowserWindow({
      ...windowProperty,
      webPreferences: {
        ...windowProperty.webPreferences, ...securePreferences(),
        additionalArguments: [],
      },
    });
    const contents = window.webContents;
    if (!this.securedSessions.has(contents.session)) {
      this.securedSessions.add(contents.session);
      const csp = contentSecurityPolicy(this.appEntry, getServerFinalEndpoint(),
        process.env.NODE_ENV === "development");
      contents.session.webRequest.onHeadersReceived((details, callback) => {
        if (!isAppURL(details.url, this.appEntry))
          return callback({ responseHeaders: details.responseHeaders });
        const headers = { ...details.responseHeaders };
        for (const key of Object.keys(headers))
          if (key.toLowerCase() === "content-security-policy") delete headers[key];
        headers["Content-Security-Policy"] = [csp];
        callback({ responseHeaders: headers });
      });
    }
    this.trustedWindows.set(contents.id, role);
    const contentsId = contents.id;
    contents.once("destroyed", () => {
      this.trustedWindows.delete(contentsId);
      for (const topic of Object.keys(this.ipcService?.listenerMap || {}))
        this.ipcService.listenerMap[topic] =
          this.ipcService.listenerMap[topic].filter(id => id !== contentsId);
    });
    contents.on("will-navigate", (event, target) => {
      if (!isAppURL(target, this.appEntry)) event.preventDefault();
    });
    contents.on("will-redirect", (event, target) => {
      if (!isAppURL(target, this.appEntry)) event.preventDefault();
    });
    contents.on("will-attach-webview", event => event.preventDefault());
    contents.setWindowOpenHandler(({ url: target }) => {
      if (role !== "main" || !canOpenOAuth(target, getServerFinalEndpoint()))
        return { action: "deny" };
      return { action: "allow", overrideBrowserWindowOptions: {
        webPreferences: secureOAuthPreferences(),
      }};
    });
    contents.on("did-create-window", child => {
      // OAuth retains window.opener.postMessage, but no native bridge.
      child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    });
    let refinedUrl = (urlPrefix + "#" + url).replace(/\s/g, "");

    window.loadURL(refinedUrl);
    window.on("ready-to-show", () => {
      window.show();
      if (shown) shown(window);
      // window.blur();
      // window.focus();

      if (parameter) {
        window.webContents.send("__window_param__", parameter);
      }
    });

    return window;
  }

  createMainWindow(overlapWindowProperty = {}) {
    let windowProperty = new WindowPropertyFactory()
      .windowType(WindowType.Modeless)
      .show(false)
      .center(true)
      .frame(false)
      .minWidth(900)
      .minHeight(600)
      .width(1440)
      .height(960)
      .backgroundThrottling(false)
      .build();
    windowProperty = lodash.merge({}, windowProperty, overlapWindowProperty);
    let mainWindow = this.invokeWindow("/", windowProperty, null, null, "main");
    return mainWindow;
  }

  createModalWindow(browserId, url, windowProperty, parameter) {
    let currentlyFocusedWindow, currentlyFocusedWindowCenterPos;
    let defaultWindowFactory = new WindowPropertyFactory()
      .import(windowProperty)
      .modal(true)
      .resizable(false)
      .frame(false)
      .center(true);

    if (browserId) {
      currentlyFocusedWindow = BrowserWindow.fromId(browserId);
      currentlyFocusedWindowCenterPos = this.getWindowCenterPos(
        currentlyFocusedWindow
      );
      defaultWindowFactory.parent(currentlyFocusedWindow);
    }

    const defaultWindowProperty = defaultWindowFactory.build();
    let newWindow = this.invokeWindow(
      "/modal" + url,
      defaultWindowProperty,
      parameter
    );

    if (browserId) {
      this.setWindowCenterPos(
        newWindow,
        currentlyFocusedWindowCenterPos.x,
        currentlyFocusedWindowCenterPos.y
      );
    }

    return newWindow;
  }

  createModelessWindow(browserId, url, windowProperty, parameter) {
    let currentlyFocusedWindow, currentlyFocusedWindowCenterPos;
    let defaultWindowFactory = new WindowPropertyFactory()
      .import(windowProperty)
      .modal(false)
      .resizable(true)
      .frame(false)
      .center(true);

    if (browserId) {
      currentlyFocusedWindow = BrowserWindow.fromId(browserId);
      currentlyFocusedWindowCenterPos = this.getWindowCenterPos(
        currentlyFocusedWindow
      );
      defaultWindowFactory.parent(currentlyFocusedWindow);
    }

    const defaultWindowProperty = defaultWindowFactory.build();
    let newWindow = this.invokeWindow(
      "/modal" + url,
      defaultWindowProperty,
      parameter
    );

    if (browserId) {
      this.setWindowCenterPos(
        newWindow,
        currentlyFocusedWindowCenterPos.x,
        currentlyFocusedWindowCenterPos.y
      );
    }

    return newWindow;
  }

  async createUpdaterWindow(overlapWindowProperty) {
    let windowProperty = new WindowPropertyFactory()
      .windowType(WindowType.Modeless)
      .show(false)
      .center(true)
      .frame(false)
      .width(300)
      .height(250)
      .resizable(false)
      .build();

    windowProperty = lodash.merge({}, windowProperty, overlapWindowProperty);
    return new Promise((resolve, reject) => {
      try {
        let window = this.invokeWindow(
          "/update-checker",
          windowProperty,
          null,
          (window) => {
            resolve(window);
          },
          "updater"
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  createAlertPopupWindow(url, windowProperty, parameter) {
    const display = screen.getPrimaryDisplay();
    const displayWorkArea = display.workArea;

    let defaultWindowProperty = new WindowPropertyFactory()
      .windowType(WindowType.Modeless)
      .show(false)
      .center(true)
      .frame(false)
      .width(AlertPopupConstants.DEFAULT_WIDTH)
      .height(AlertPopupConstants.DEFAULT_HEIGHT)
      .xCoordinate(
        displayWorkArea.width -
          AlertPopupConstants.DEFAULT_WIDTH -
          AlertPopupConstants.RIGHT_MARGIN
      )
      .yCoordinate(
        displayWorkArea.height -
          AlertPopupConstants.DEFAULT_HEIGHT -
          AlertPopupConstants.BOTTOM_MARGIN
      )
      .resizable(false)
      .import(windowProperty)
      .build();

    let newWindow = this.invokeWindow(
      "/alert-popup" + url,
      defaultWindowProperty,
      parameter
    );
    return newWindow;
  }

  getWindowCenterPos(window) {
    let LUpos = window.getPosition();
    let size = window.getSize();

    return {
      x: parseInt(LUpos[0] + size[0] / 2),
      y: parseInt(LUpos[1] + size[1] / 2),
    };
  }

  setWindowCenterPos(window, x, y) {
    let size = window.getSize();

    window.setPosition(parseInt(x - size[0] / 2), parseInt(y - size[1] / 2));
  }

  setWindowStateChangeListener(window) {
    window.on("minimize", (e) => {
      this.ipcService.sender("win_state_changed", null, true, "minimize");
    });
    window.on("maximize", (e) => {
      this.ipcService.sender("win_state_changed", null, true, "maximize");
    });
    window.on("unmaximize", (e) => {
      this.ipcService.sender("win_state_changed", null, true, "unmaximize");
    });
    window.on("restore", (e) => {
      this.ipcService.sender("win_state_changed", null, true, "restore");
    });
  }
}

module.exports = WindowService;
