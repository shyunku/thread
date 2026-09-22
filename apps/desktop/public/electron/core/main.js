/* ---------------------------------------- import ---------------------------------------- */
const { app } = require("electron");
const packageJson = require("../../../package.json");
const { configureDevelopmentIdentity, getDesktopAppId } = require("../modules/appIdentity");

// Must precede logger/services/session initialization and the instance lock.
configureDevelopmentIdentity(app, getDesktopAppId(packageJson));

/**
 * Flag that indicates whether current process context is on build mode.
 * If this process is invoked by non-dev environment, this flag will be true.
 * Otherwise, this will be false.
 */
const isBuildMode = !process.env.ELECTRON_START_URL;
const appDataPath = app.getAppPath();

console.log("MAIN_LOG");

require("../modules/initializer").all(isBuildMode, appDataPath);
const ArchCategory = require("../constants/ArchCategory.constants");
const Util = require("../modules/util");
const FileSystem = require("../modules/filesystem");
const ServiceGroup = require("./serviceGroup");
const { getBuildLevel } = require("../util/SystemUtil");
/* ---------------------------------------- Declaration ---------------------------------------- */
/* -------------------- General -------------------- */
// Manage service packages as a group
const serviceGroup = new ServiceGroup();

/**
 * Flag that indicates whether this process context is on production mode.
 * Only deployed version of program should have this value as true, otherwise this will be false.
 */
process.env.NODE_ENV =
  process.env.NODE_ENV &&
  process.env.NODE_ENV.trim().toLowerCase() === "development"
    ? "development"
    : "production";
let isProdMode = process.env.NODE_ENV === "production";
let buildLevel = getBuildLevel();

const osCategory = Util.getSystemArchCategory();
const osLabel = Util.getSystemArchitectureLabel();

const isWindowsOS = osCategory === ArchCategory.Windows;
const isMacOS = osCategory === ArchCategory.MacOS;
const userDataPath = FileSystem.getUserDataPath();

/* ---------------------------------------- Pre-execute statements ---------------------------------------- */
if (!isWindowsOS && !isMacOS) {
  console.error("MAIN_ERROR");
  process.exit(-1);
}
console.debug("MAIN_DEBUG");
console.debug("MAIN_DEBUG");
console.debug("MAIN_DEBUG");
console.debug("MAIN_DEBUG");
console.debug("MAIN_DEBUG");
console.debug("MAIN_DEBUG");
console.debug("MAIN_DEBUG");

/* ---------------------------------------- Main execute statements ---------------------------------------- */
// auto start app on startup of OS (only on production mode)
app.setLoginItemSettings({
  openAtLogin: isProdMode,
});

app.on("ready", async () => {
  try {
    if (!checkDuplicateInvoke()) return;
    // initialize & configure all services
    serviceGroup.injectReferences();


    // check update
    await serviceGroup.updaterService.invokeUpdateChecker();

    // run all services
    serviceGroup.configureAndRun();

    // TODO :: check utility of this command
    // powerSaveBlocker.start('prevent-app-suspension');
    // app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100');
  } catch (err) {
    console.error("MAIN_ERROR");
    app.quit();
    throw err;
  }
});

app.on("browser-window-created", (e, window) => {
  const mainWindow = serviceGroup.windowService.mainWindow;
  if (mainWindow == null || window.id === mainWindow.id) return;
  console.debug("turn off menu bar");
  window.setMenu(null);
  window.webContents.session.clearCache(() => {});
  // window.webContents.openDevTools();
});

function checkDuplicateInvoke() {
  if (!packageJson.allowMultipleExecution) {
    let getInstanceLock = app.requestSingleInstanceLock();

      if (!getInstanceLock) {
        console.log(
          "Instance is locked by single instance lock (already running). exiting app..."
        );
        app.quit();
        return false;
      } else {
        const s = serviceGroup.windowService;
        app.on("second-instance", (event, commandLine, workingDirectory) => {
          if (s.mainWindow) {
            if (s.mainWindow.isMinimized()) {
              s.mainWindow.restore();
            }
            s.mainWindow.focus();
          }

          console.log("Something trying to open already opened-program.");
        });
      }
  }
  return true;
}
