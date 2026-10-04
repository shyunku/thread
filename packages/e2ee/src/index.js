// Install the platform once (src/platform.js), then load modules directly, e.g.
// require("@thread/e2ee/src/protocol"). Modules are not loaded here so that
// requiring the package never touches crypto before a platform is installed.
module.exports={platform:require("./platform")};
