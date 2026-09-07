const fs = require("fs");
const path = require("path");

const DEFAULT_APP_ID = "kr.threadapp.desktop";

function getDesktopAppId(packageJson = {}) {
  return packageJson?.build?.appId || DEFAULT_APP_ID;
}

function configureDevelopmentIdentity(app, appId, env = process.env) {
  // Packaged installations always keep their existing identity and data paths.
  if (app.isPackaged || (!env.ELECTRON_START_URL &&
      env.NODE_ENV?.trim().toLowerCase() !== "development")) return;

  const devUserData = path.join(app.getPath("appData"), "thread-dev");
  fs.mkdirSync(devUserData, { recursive: true });
  app.setName("Thread Dev");
  app.setPath("userData", devUserData);
  app.setPath("sessionData", devUserData);
  if (process.platform === "win32") app.setAppUserModelId(`${appId}.dev`);
}

module.exports = { configureDevelopmentIdentity, getDesktopAppId };
