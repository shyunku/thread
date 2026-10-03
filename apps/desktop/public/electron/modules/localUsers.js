// Local account rows in the root database (users table from resources/root.sqlite3).
// auth_hashed_pw is NOT NULL there; an account seen only through Google gets "" until
// the user signs in with a password on this device.
async function saveGoogleUser(rootDB, user) {
  const users = await rootDB.all("SELECT uid FROM users WHERE uid = ?;", [user.uid]);
  if (users.length === 0) {
    await rootDB.run(
      "INSERT INTO users (uid, auth_id, username, google_auth_id, google_email, google_profile_image_url, auth_hashed_pw) VALUES (?, ?, ?, ?, ?, ?, ?);",
      [user.uid, user.auth_id, user.username, user.google_auth_id, user.google_email, user.google_profile_image_url, ""]
    );
  } else {
    await rootDB.run(
      "UPDATE users SET username = ?, google_auth_id = ?, google_email = ?, google_profile_image_url = ? WHERE uid = ?;",
      [user.username, user.google_auth_id, user.google_email, user.google_profile_image_url, user.uid]
    );
  }
}
module.exports = { saveGoogleUser };
