import { getGoogleSignupUser, persistLoginSession } from "./loginSession";

const auth = {
  access_token: { token: "test-access" },
  refresh_token: { token: "test-refresh" },
};

test.each([409, 400, 500, undefined])(
  "signup failure %s cannot provide a user or persist credentials",
  async (status) => {
    const register = jest.fn();
    const user = getGoogleSignupUser({ success: false, data: status });
    expect(user).toBeNull();
    await expect(persistLoginSession(user, auth, register)).rejects.toThrow(
      "INVALID_AUTH_INFO"
    );
    expect(register).not.toHaveBeenCalled();
  }
);

test.each([undefined, null, {}, { userId: "" }, { userId: " " }])(
  "malformed signup success is rejected: %s",
  (user) => {
    expect(getGoogleSignupUser({ success: true, data: { user } })).toBeNull();
  }
);

test.each([undefined, {}, { access_token: { token: "a" } }])(
  "incomplete tokens do not reach persistence: %s",
  async (incompleteAuth) => {
    const register = jest.fn();
    await expect(
      persistLoginSession({ uid: "user-1" }, incompleteAuth, register)
    ).rejects.toThrow("INVALID_AUTH_INFO");
    expect(register).not.toHaveBeenCalled();
  }
);

test("valid signup credentials are persisted before completion", async () => {
  const user = getGoogleSignupUser({
    success: true,
    data: { user: { userId: "user-1" } },
  });
  let finish;
  const register = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const completed = jest.fn();
  const pending = persistLoginSession({ uid: user.userId }, auth, register)
    .then(completed);
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(register).toHaveBeenCalledWith("user-1", "test-access", "test-refresh");
  expect(completed).toHaveBeenCalledTimes(1);
});

test("local persistence failure is propagated to the login screen", async () => {
  const register = jest.fn().mockRejectedValue(new Error("NOT_IN_LOCAL"));
  await expect(
    persistLoginSession({ uid: "user-1" }, auth, register)
  ).rejects.toThrow("NOT_IN_LOCAL");
});
