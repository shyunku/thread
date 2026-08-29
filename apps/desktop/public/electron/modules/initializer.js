const __console__ = require("./console");
const __array__ = require("./array");
const remoteMain = require("@electron/remote/main");
const dotenv = require("dotenv");
const path = require("path");
const logger = require("./logger");

function loadAppEnvironment() {
  const appRoot = path.resolve(__dirname, "../../..");
  const isProduction =
    process.env.NODE_ENV?.trim().toLowerCase() !== "development";

  // Production values take precedence; .env is the development/default fallback.
  if (isProduction) {
    dotenv.config({ path: path.resolve(appRoot, ".env.production") });
  }
  dotenv.config({ path: path.resolve(appRoot, ".env") });
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
