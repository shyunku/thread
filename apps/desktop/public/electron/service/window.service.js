const { app, BrowserWindow, screen } = require("electron");
const WindowPropertyFactory = require("../util/WindowPropertyFactory");
const { WindowType } = require("../modules/constants");
const {
  appEntryURL, isAppURL, securePreferences, canOpenOAuth, validRoute,
  contentSecurityPolicy, secureOAuthPreferences, isOAuthCallbackURL, parseOAuthResult,
} = require("../modules/windowSecurity");
const { getServerFinalEndpoint } = require("../modules/util");
const AlertPopupConstants = require("../constants/AlertPopup.constants");
const lodash = require("lodash");
const { loadWindowState, saveWindowState, placeWindow } = require("../modules/windowState");
const { setVaultWindow, vaultPrevious } = require("../modules/vaultWindow");
const path = require("node:path");
const appIcon = path.join(__dirname, "..", "..", "favicon512.ico");

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
    // True while the main window shows the workspace; only then are its moves remembered (#106).
    this.workspaceWindow = false;
    // Set while the main window is hidden until the workspace has loaded (#106).
    this.pendingReveal = null;
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
      icon: appIcon,
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
      // The OAuth window gets no native bridge and cannot open further windows.
      child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      // Read the callback's inert JSON here and hand it only to the opener.
      // The page no longer posts tokens to window.opener with an unchecked origin.
      child.webContents.on("did-finish-load", async () => {
        if (!isOAuthCallbackURL(child.webContents.getURL(), getServerFinalEndpoint())) return;
        let result = null;
        try {
          result = parseOAuthResult(await child.webContents.executeJavaScript(
            `document.getElementById("thread-oauth-result")?.textContent ?? null`));
        } catch {}
        if (!contents.isDestroyed())
          contents.send("auth/googleOauthResult", null, { success: result != null, data: result });
        if (!child.isDestroyed()) child.close();
      });
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
      .minWidth(760)
      .minHeight(600)
      .width(1440)
      .height(960)
      .backgroundThrottling(false)
      .build();
    windowProperty = lodash.merge({}, windowProperty, overlapWindowProperty);
    // The window opens centered on the main display, so the lock and setup screens stay there
    // as before; the workspace moves to its remembered place when it opens (setVaultMode, #107).
    let mainWindow = this.invokeWindow("/", windowProperty, null, null, "main");
    this.trackWindowState(mainWindow);
    return mainWindow;
  }

  placeSaved(state) {
    return placeWindow(state, screen.getAllDisplays().map((d) => d.workArea), screen.getPrimaryDisplay().workArea);
  }

  // Saves the main window's place and size shortly after it moves or resizes, and when it closes.
  trackWindowState(window) {
    let timer = null;
    const save = () => {
      clearTimeout(timer);
      timer = null;
      if (!this.workspaceWindow || window.isDestroyed() || window.isFullScreen()) return;
      saveWindowState(app, { ...window.getNormalBounds(), maximized: window.isMaximized() });
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 500);
    };
    for (const event of ["resize", "move", "maximize", "unmaximize"]) window.on(event, later);
    window.on("close", save);
    window.on("session-end", save);
    this.flushWindowState = save;
  }

  // The login, lock and setup screens (#106): save the workspace place first, then stop
  // remembering while they use their own sizes. A window hidden for loading shows right away.
  leaveWorkspaceWindow() {
    if (this.workspaceWindow) this.flushWindowState?.();
    this.workspaceWindow = false;
    this.revealMainWindow({ maximize: false });
  }

  // vault/windowMode: "lock" and "setup" use the small screens; "app" returns to the workspace.
  // Coming back from another screen, the window hides, moves to its remembered place and shows
  // again once the workspace says it has loaded (vault/windowReady), so the loading never shows.
  setVaultMode(mode) {
    const w = this.mainWindow;
    if (!w || w.isDestroyed()) return false;
    const workArea = screen.getDisplayMatching(w.getBounds()).workArea;
    if (mode !== "app") {
      if (!["setup", "lock"].includes(mode)) throw Error("INVALID_WINDOW_MODE");
      this.leaveWorkspaceWindow();
      return setVaultWindow(w, mode, workArea);
    }
    if (this.workspaceWindow) return setVaultWindow(w, mode, workArea);
    const visible = w.isVisible();
    if (visible) {
      // Transparent first: a hidden window can still be drawn at its new place for a moment,
      // so the unlock window seemed to move before it went away (#107). Any later show puts
      // the opacity back.
      w.setOpacity(0);
      w.once("show", () => { if (!w.isDestroyed()) w.setOpacity(1); });
      w.hide();
    }
    const old = vaultPrevious(w);
    setVaultWindow(w, mode, workArea, { maximize: false });
    const saved = loadWindowState(app);
    if (saved) w.setBounds(this.placeSaved(saved));
    this.workspaceWindow = true;
    const maximized = saved ? saved.maximized : !!old?.maximized;
    clearTimeout(this.pendingReveal?.timer);
    this.pendingReveal = null;
    if (visible) {
      // Shown anyway after a while, e.g. when the server is slow to answer.
      const timer = setTimeout(() => this.revealMainWindow(), 5000);
      this.pendingReveal = { maximized, timer };
    } else if (maximized) {
      // Hidden in the tray: keep it hidden, maximized when it is shown.
      w.once("show", () => { if (this.workspaceWindow && !w.isDestroyed()) w.maximize(); });
    }
    return true;
  }

  revealMainWindow({ maximize = true } = {}) {
    const pending = this.pendingReveal, w = this.mainWindow;
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingReveal = null;
    if (!w || w.isDestroyed()) return false;
    if (maximize && pending.maximized) w.maximize();
    w.show();
    w.focus();
    return true;
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
