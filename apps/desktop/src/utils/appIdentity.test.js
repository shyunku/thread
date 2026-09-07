const fs = require("fs");
const path = require("path");
const {
  configureDevelopmentIdentity,
  getDesktopAppId,
} = require("../../public/electron/modules/appIdentity");

jest.mock("fs", () => ({ mkdirSync: jest.fn() }));

const makeApp = (isPackaged = false) => ({
  isPackaged,
  getPath: jest.fn(() => "fixture-app-data"),
  setName: jest.fn(),
  setPath: jest.fn(),
  setAppUserModelId: jest.fn(),
});

beforeEach(() => jest.clearAllMocks());

test("uses the production app ID when packaged metadata omits build config", () => {
  expect(getDesktopAppId({ version: "1.1.3" })).toBe("kr.threadapp.desktop");
  expect(getDesktopAppId({ build: { appId: "custom.desktop" } })).toBe("custom.desktop");
});

test.each([
  { NODE_ENV: "development" },
  { NODE_ENV: " development " },
  { ELECTRON_START_URL: "http://localhost:9300" },
])("isolates the dev profile before startup (%j)", (env) => {
  const app = makeApp();
  configureDevelopmentIdentity(app, "kr.threadapp.desktop", env);
  const directory = path.join("fixture-app-data", "thread-dev");
  expect(fs.mkdirSync).toHaveBeenCalledWith(directory, { recursive: true });
  expect(app.setName).toHaveBeenCalledWith("Thread Dev");
  expect(app.setPath.mock.calls).toEqual([["userData", directory], ["sessionData", directory]]);
  if (process.platform === "win32") {
    expect(app.setAppUserModelId).toHaveBeenCalledWith("kr.threadapp.desktop.dev");
  }
});

test.each([{}, { NODE_ENV: "production" }])("leaves non-dev identity untouched", (env) => {
  const app = makeApp();
  configureDevelopmentIdentity(app, "kr.threadapp.desktop", env);
  expect(app.setPath).not.toHaveBeenCalled();
  expect(app.setName).not.toHaveBeenCalled();
  expect(fs.mkdirSync).not.toHaveBeenCalled();
});

test("packaged apps retain production data even with inherited dev variables", () => {
  const app = makeApp(true);
  configureDevelopmentIdentity(app, "kr.threadapp.desktop", { NODE_ENV: "development", ELECTRON_START_URL: "http://localhost:9300" });
  expect(app.setPath).not.toHaveBeenCalled();
  expect(app.setName).not.toHaveBeenCalled();
  expect(fs.mkdirSync).not.toHaveBeenCalled();
});
