const nonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

export const getGoogleSignupUser = (response) => {
  if (response?.success !== true) return null;
  const user = response.data?.user;
  return nonEmptyString(user?.userId) ? user : null;
};

export const persistLoginSession = async (user, auth, register) => {
  const accessToken = auth?.access_token?.token;
  const refreshToken = auth?.refresh_token?.token;
  if (
    !nonEmptyString(user?.uid) ||
    !nonEmptyString(accessToken) ||
    !nonEmptyString(refreshToken)
  ) {
    throw new Error("INVALID_AUTH_INFO");
  }
  await register(user.uid, accessToken, refreshToken);
};
