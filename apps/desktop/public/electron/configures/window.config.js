const {
  ipcMain,
  webContents,
  app,
  BrowserWindow,
  screen,
  remote,
  Menu,
  Tray,
  shell,
} = require("electron");
const packageJson = require("../../../package.json");
const path = require("path");
const url = require("url");
const { getAppTrayImagePath } = require("../modules/filesystem");
const { getLogFilePath } = require("../modules/logger");

/**
 * @param s {WindowService}
 */
module.exports = function (s) {
  s.mainWindow = s.createMainWindow({
    webPreferences: {
      preload: path.join(__dirname, "../", "modules", "preload.js"),
    },
  });
  s.mainWindow.once("ready-to-show", () => {
    s.mainWindow.show();
    s.mainWindow.focus();
  });

  const isDebugMode = process.env.NODE_ENV !== "production";

  const trayImagePath = getAppTrayImagePath();
  s.tray = new Tray(trayImagePath);
  s.tray.on("click", () => {
    s.mainWindow.show();
  });
  s.tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `Thread - ${packageJson.version}${
          isDebugMode ? " [Debug]" : ""
        }`,
        enabled: false,
      },
      {
        label: "로그 보기",
        click: function () {
          const logFilePath = getLogFilePath();
          if (logFilePath) shell.showItemInFolder(logFilePath);
        },
      },
      {
        label: "종료",
        click: function () {
          s.mainWindow.close();
          app.quit();
          app.exit();
        },
      },
    ])
  );

  s.setWindowStateChangeListener(s.mainWindow);
  // s.mainWindow.webContents.session.clearCache(() => {});
};
