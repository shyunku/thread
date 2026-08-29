const __console__ = require("./console");
const __array__ = require("./array");
const remoteMain = require("@electron/remote/main");
const dotenv = require("dotenv");
const path = require("path");
const logger = require("./logger");

function loadAppEnvironment() {
  const mode =
    process.env.NODE_ENV?.trim().toLowerCase() === "development"
      ? "development"
      : "production";
  const appRoot = path.resolve(__dirname, "../../..");

  // Match Create React App precedence: local mode overrides first, then mode defaults.
  dotenv.config({ path: path.resolve(appRoot, `.env.${mode}.local`) });
  dotenv.config({ path: path.resolve(appRoot, `.env.${mode}`) });

  // Preserve Electron-only updater, socket, and signing settings during migration.
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
}

module.exports = {
  all: (isBuildMode, appDataPath) => {
    logger.initialize(isBuildMode, appDataPath);
    __console__();
    __array__();
    remoteMain.initialize();
    loadAppEnvironment();

    return {};
  },
};
