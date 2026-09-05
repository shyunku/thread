import fs from "fs";
import path from "path";
import vm from "vm";

const auth = { access_token: { token: "thread-access" }, refresh_token: { token: "thread-refresh" } };

function setup(rows = []) {
  const handlers = {};
  const db = { all: jest.fn().mockResolvedValue(rows), run: jest.fn().mockResolvedValue() };
  const service = {
    register: (topic, handler) => { handlers[topic] = handler; },
    sender: jest.fn(),
    databaseService: { getRootDatabaseContext: async () => db },
  };
  const context = {
    module: { exports: {} },
    require: () => ({ getServerFinalEndpoint: () => "http://test/v1" }),
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.resolve("public/electron/configures/ipc.config.js"), "utf8"), context);
  context.module.exports(service);
  return { handler: handlers["auth/sendGoogleOauthResult"], db, service };
}

test("existing server Google user signs in on a fresh local database", async () => {
  const { handler, db, service } = setup();
  const user = { uid: "server-user", auth_id: "account", username: "Test", google_auth_id: "google-user", google_email: "test@example.com", google_profile_image_url: "" };
  await handler({}, "request", { user, auth });
  expect(db.all).toHaveBeenCalledWith(expect.any(String), ["server-user"]);
  expect(db.run).toHaveBeenCalledTimes(1);
  expect(service.sender).toHaveBeenCalledWith("auth/sendGoogleOauthResult", "request", true, { isSignupNeeded: false, user });
});

test("unknown server Google user requires signup even if local records exist", async () => {
  const { handler, db, service } = setup([{ uid: "stale-local-user" }]);
  await handler({}, "request", { user: null, auth: null });
  expect(db.run).not.toHaveBeenCalled();
  expect(service.sender).toHaveBeenCalledWith("auth/sendGoogleOauthResult", "request", true, { isSignupNeeded: true, user: null });
});

test("legacy API response cannot silently reuse provider tokens", async () => {
  const { handler, db, service } = setup();
  await handler({}, "request", { auth });
  expect(db.run).not.toHaveBeenCalled();
  expect(service.sender).toHaveBeenCalledWith("auth/sendGoogleOauthResult", "request", false, "API_UPDATE_REQUIRED");
});
