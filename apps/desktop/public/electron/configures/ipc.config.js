/**
 * @param ipcService {IpcService}
 */
const { app, BrowserWindow, powerMonitor, shell } = require("electron");
const Request = require("../core/request");
const sha256 = require("sha256");
const { getServerFinalEndpoint } = require("../modules/util");
const { rendererWindowOptions } = require("../modules/windowSecurity");

/**
 * @param s {IpcService}
 */
module.exports = function (s) {
  const vaultActions={
    "vault/windowMode":mode=>s.windowService.setVaultMode(mode),
    // The workspace has loaded: show the main window hidden by "app" mode (#106).
    "vault/windowReady":()=>s.windowService.revealMainWindow(),
    "vault/groupConflict":(action,input)=>s.vaultWorkspaceService.groupConflict(action,input),
    "vault/rotation":(action,input)=>s.vaultWorkspaceService.rotation(action,input),
    "vault/lostRecovery":(action,input)=>s.vaultWorkspaceService.lostRecovery(action,input),
    "vault/backup":(action,input)=>s.vaultWorkspaceService.backup(action,input),
    "vault/reencryption":(action,input)=>s.vaultWorkspaceService.reencryption(action,input),
    "vault/bootstrap":uid=>s.vaultWorkspaceService.bootstrap(uid),
    "vault/sync":()=>s.vaultWorkspaceService.syncEncrypted(),
    "vault/outboxReviews":request=>s.vaultWorkspaceService.outboxReviews(request),
    "vault/outboxDetail":request=>s.vaultWorkspaceService.outboxDetail(request),
    "vault/resolveConflict":request=>s.vaultWorkspaceService.resolveConflict(request),
    "vault/reconcileConflict":request=>s.vaultWorkspaceService.reconcileConflict(request),
    "vault/pairing":(action,input)=>s.vaultWorkspaceService.pairing(action,input),
    "vault/relay":(action,input)=>s.vaultWorkspaceService.relay(action,input),
    "vault/registrationEndpoint":()=>{s.vaultWorkspaceService.context();return s.vaultWorkspaceService.registrationEndpoint();},
    "vault/registerIdentity":()=>s.vaultWorkspaceService.registerIdentity(),
    "vault/activateEmpty":()=>s.vaultWorkspaceService.activateEmpty(),
    "vault/prepareIdentity":()=>s.vaultWorkspaceService.prepareIdentity(),
    "vault/identityStatus":()=>s.vaultWorkspaceService.identityStatus(),
    "vault/recoveryCode":()=>s.vaultWorkspaceService.recoveryCode(),
    "vault/recoveryCodePreview":()=>s.vaultWorkspaceService.recoveryCodePreview(),
    "vault/copyRecoveryCode":()=>s.vaultWorkspaceService.copyRecoveryCode(),
    "vault/exportRecovery":()=>s.vaultWorkspaceService.exportRecovery(),
    "vault/confirmRecovery":code=>s.vaultWorkspaceService.confirmRecovery(code),
    "vault/getStatus":()=>s.vaultWorkspaceService.status(),
    "vault/create":password=>s.vaultWorkspaceService.create(password),
    "vault/unlock":(method,password)=>s.vaultWorkspaceService.unlock(method,password),
    "vault/verifyUser":input=>s.vaultWorkspaceService.verifyUser(input),
    "vault/lock":()=>{s.vaultWorkspaceService.lock();return true;},
    "vault/revokeOtherSessions":()=>s.vaultWorkspaceService.revokeOtherSessions(),
    "vault/deleteAccount":input=>s.vaultWorkspaceService.deleteAccount(input),
  };
  for(const [topic,action] of Object.entries(vaultActions))s.register(topic,async(event,reqId,...args)=>{
    const reply=await require("../e2ee/vaultIpcReply").vaultIpcReply(s,topic,action,args);
    event.sender.send(topic,reqId,reply);
  });
  for (const action of ["get", "download", "install", "update", "cancel"]) {
    const topic = "release-alert/" + action;
    s.register(topic, async (event, reqId) => {
      if (event.sender !== s.windowService.mainWindow?.webContents) {
        s.sender(topic, reqId, false, null);
        return;
      }
      try {
        if (action === "get") await s.releaseAlertService.check();
        if (action === "download") await s.releaseAlertService.download();
        if (action === "install") await s.releaseAlertService.install();
        if (action === "update") await s.releaseAlertService.update();
        if (action === "cancel") s.releaseAlertService.cancel();
        s.sender(topic, reqId, true, s.releaseAlertService.current);
      } catch { s.sender(topic, reqId, false, null); }
    });
  }
  powerMonitor?.on("resume", () => {
    void s.releaseAlertService.check();
  });
  const appServerFinalEndpoint = getServerFinalEndpoint();
  /* ---------------------------------------- System ---------------------------------------- */
  s.register("system/terminate_signal", (event, reqId, param) => {
    app.quit();
  });

  s.register("system/relaunch", (event, reqId, param) => {
    app.relaunch();
    app.exit();
  });

  // App preferences (app-settings.json). Main window only.
  const appSettings = require("../modules/appSettings");
  const settingsView = () => ({ ...appSettings.getSettings(), restartRequired: appSettings.restartRequired() });
  s.register("settings/get", (event, reqId) => {
    if (event.sender !== s.windowService.mainWindow?.webContents) return s.sender("settings/get", reqId, false, null);
    s.sender("settings/get", reqId, true, settingsView());
  });
  s.register("settings/set", (event, reqId, patch) => {
    if (event.sender !== s.windowService.mainWindow?.webContents) return s.sender("settings/set", reqId, false, null);
    try {
      const next = appSettings.updateSettings(patch);
      if ("autoStart" in patch && process.env.NODE_ENV === "production")
        app.setLoginItemSettings({ openAtLogin: next.autoStart });
      if ("betaUpdates" in patch) void s.releaseAlertService.check();
      if ("reminders" in patch) s.remindersService?.settingsChanged();
      s.sender("settings/set", reqId, true, settingsView());
    } catch {
      s.sender("settings/set", reqId, false, null);
    }
  });

  // Due reminders (#91): the renderer's clock format for the notification text.
  s.register("reminder/time-format", (event, reqId, value) => {
    if (event.sender !== s.windowService.mainWindow?.webContents) return s.sender("reminder/time-format", reqId, false, null);
    s.remindersService?.setTimeFormat(value);
    s.sender("reminder/time-format", reqId, true, null);
  });

  // Patch notes shown after an update (#99): the last shown version. Main window only.
  const patchNotesState = require("../modules/patchNotesState");
  const appVersion = () => require("../../../package.json").version;
  s.register("patch-notes/state", (event, reqId) => {
    if (event.sender !== s.windowService.mainWindow?.webContents) return s.sender("patch-notes/state", reqId, false, null);
    s.sender("patch-notes/state", reqId, true, patchNotesState.readSeen(app.getPath("userData"), appVersion()));
  });
  s.register("patch-notes/seen", (event, reqId) => {
    if (event.sender !== s.windowService.mainWindow?.webContents) return s.sender("patch-notes/seen", reqId, false, null);
    try {
      patchNotesState.markSeen(app.getPath("userData"), appVersion());
      s.sender("patch-notes/seen", reqId, true, null);
    } catch {
      s.sender("patch-notes/seen", reqId, false, null);
    }
  });

  // External links: Thread's site over HTTPS and the contact address only.
  s.register("system/openExternal", (event, reqId, target) => {
    if (event.sender !== s.windowService.mainWindow?.webContents) return s.sender("system/openExternal", reqId, false, null);
    if (!require("../modules/externalLinks").isAllowedExternal(target)) return s.sender("system/openExternal", reqId, false, null);
    shell.openExternal(target).then(() => s.sender("system/openExternal", reqId, true, null))
      .catch(() => s.sender("system/openExternal", reqId, false, null));
  });

  s.register("system/close_window", (event, reqId, param) => {
    let currentWindow = BrowserWindow.fromWebContents(event.sender);
    let mainWindow = s.windowService.mainWindow;
    if (currentWindow) {
      if (currentWindow.id === mainWindow.id) {
        // "창을 닫으면 트레이로" (default on); off quits the app.
        if (require("../modules/appSettings").getSettings().closeToTray) mainWindow.hide();
        else app.quit();
        return;
      }
      currentWindow.close();
    }
  });

  s.register("system/maximize_window", (event, reqId, param) => {
    let currentWindow = BrowserWindow.fromWebContents(event.sender);
    if (currentWindow) currentWindow.maximize();
  });

  s.register("system/minimize_window", (event, reqId, param) => {
    let currentWindow = BrowserWindow.fromWebContents(event.sender);
    if (currentWindow) currentWindow.minimize();
  });

  s.register("system/restore_window", (event, reqId, param) => {
    let currentWindow = BrowserWindow.fromWebContents(event.sender);
    if (currentWindow) currentWindow.restore();
  });

  s.register("system/isMaximizable", (event, reqId, param) => {
    let currentWindow = BrowserWindow.fromWebContents(event.sender);
    if (currentWindow)
      s.sender("system/isMaximizable", reqId, true, currentWindow.isMaximizable());
  });

  s.register("system/modal", (event, reqId, _claimedId, route, options, parameter) => {
    s.windowService.createModalWindow(BrowserWindow.fromWebContents(event.sender).id,
      route, rendererWindowOptions(options), parameter);
  });

  s.register("system/modeless", (event, reqId, _claimedId, route, options, parameter) => {
    s.windowService.createModelessWindow(BrowserWindow.fromWebContents(event.sender).id,
      route, rendererWindowOptions(options), parameter);
  });

  s.register("system/inner-modal", (event, reqId, route, data) => {
    s.sender("inner-modal", reqId, true, { route, data });
  });

  s.register("system/close-inner-modal", (event, reqId, ...arg) => {
    s.sender("close-inner-modal", reqId, true, ...arg);
  });

  s.register("system/computer_idle_time", (event, reqId) => {
    const idleTime = powerMonitor.getSystemIdleTime();
    s.emiter("system/computer_idle_time", reqId, idleTime);
  });

  s.register("__callback__", (event, reqId, topic, data) => {
    s.broadcast(topic, data);
  });

  /* ---------------------------------------- Custom ---------------------------------------- */
  s.register("system/setAsHomeWindow", (event, reqId) => {
    try {
      // make home window resizable
      s.windowService.mainWindow.setResizable(true);
      s.windowService.mainWindow.setFullScreenable(true);
      // s.windowService.mainWindow.setSize(1280, 960);
      s.sender("system/setAsHomeWindow", reqId, true);
    } catch (err) {
      s.sender("system/setAsHomeWindow", reqId, false, err);
      throw err;
    }
  });

  s.register("system/setAsLoginWindow", (event, reqId) => {
    try {
      // make login window non-resizable
      // The login screen has its own size; stop remembering the window's place (#106).
      s.windowService.leaveWorkspaceWindow();
      s.windowService.mainWindow.setResizable(true);
      s.windowService.mainWindow.setFullScreenable(false);
      s.windowService.mainWindow.setFullScreen(false);
      s.windowService.mainWindow.setSize(1280, 900);
      s.windowService.mainWindow.setResizable(false);
      s.windowService.showFirstScreen();
      s.sender("system/setAsLoginWindow", reqId, true);
    } catch (err) {
      s.sender("system/setAsLoginWindow", reqId, false, err);
      throw err;
    }
  });

  s.register("auth/sendGoogleOauthResult", async (event, reqId, data) => {
    try {
      const rootDB = await s.databaseService.getRootDatabaseContext();
      if (!Object.prototype.hasOwnProperty.call(data, "user")) {
        s.sender("auth/sendGoogleOauthResult", reqId, false, "API_UPDATE_REQUIRED");
        return;
      }
      const user = data.user;
      const isSignupNeeded = user == null;
      if (user) {
        if (typeof user.uid !== "string" || !user.uid.trim() ||
            !data.auth?.access_token?.token || !data.auth?.refresh_token?.token) {
          throw new Error("INVALID_AUTH_INFO");
        }
        await require("../modules/localUsers").saveGoogleUser(rootDB, user);
      }

      s.sender("auth/sendGoogleOauthResult", reqId, true, {
        isSignupNeeded,
        user,
      });
    } catch (err) {
      s.sender("auth/sendGoogleOauthResult", reqId, false);
      throw err;
    }
  });

  s.register(
    "auth/registerAuthInfoSync",
    async (event, reqId, userId, accessToken, refreshToken) => {
      try {
        if (userId == null) throw new Error("userId is null");
        if (accessToken == null) throw new Error("accessToken is null");
        if (refreshToken == null) throw new Error("refreshToken is null");

        const rootDB = await s.databaseService.getRootDatabaseContext();

        // check if user exists already
        let users = await rootDB.all(
          "SELECT * FROM users WHERE uid = ?;",
          userId
        );
        if (users.length === 0) {
          // retry
          s.sender("auth/registerAuthInfoSync", reqId, false, "NOT_IN_LOCAL");
          return;
        }

        await rootDB.run(
          "UPDATE users SET access_token = ?, refresh_token = ? WHERE uid = ?;",
          accessToken,
          refreshToken,
          userId
        );
        s.sender("auth/registerAuthInfoSync", reqId, true);
      } catch (err) {
        s.sender("auth/registerAuthInfoSync", reqId, false, err.message);
        throw err;
      }
    }
  );

  s.register("auth/deleteAuthInfo", async (event, reqId, userId) => {
    try {
      const rootDB = await s.databaseService.getRootDatabaseContext();
      // End the server session first (best effort), then forget the tokens locally.
      const [user] = await rootDB.all("SELECT refresh_token FROM users WHERE uid = ?;", [userId]);
      let endpoint = null;
      try { endpoint = s.vaultWorkspaceService.registrationEndpoint(); } catch {}
      if (endpoint && user?.refresh_token) {
        await require("../e2ee/accountSessions").logout({ endpoint, refreshToken: user.refresh_token });
      }
      await rootDB.run(
        "UPDATE users SET access_token = NULL, refresh_token = NULL WHERE uid = ?;",
        [userId]
      );
      s.sender("auth/deleteAuthInfo", reqId, true);
    } catch (err) {
      s.sender("auth/deleteAuthInfo", reqId, false);
      throw err;
    }
  });

  s.register("auth/loadAuthInfoSync", async (event, reqId, userId) => {
    try {
      const rootDB = await s.databaseService.getRootDatabaseContext();
      let users = await rootDB.all("SELECT * FROM users WHERE uid = ?;", [
        userId,
      ]);
      if (users.length === 0) throw new Error("user not found");
      let [user] = users;
      s.sender("auth/loadAuthInfoSync", reqId, true, {
        accessToken: user.access_token,
        refreshToken: user.refresh_token,
      });
    } catch (err) {
      s.sender("auth/loadAuthInfoSync", reqId, false);
      throw err;
    }
  });

  s.register(
    "auth/signUpWithGoogleAuth",
    async (event, reqId, signupRequest) => {
      try {
        let result;
        try {
          result = await Request.post(
            appServerFinalEndpoint,
            "/google_auth/signup",
            {
              username: signupRequest.username,
              auth_id: signupRequest.authId,
              encrypted_password: sha256(signupRequest.encryptedPassword),
              // Google identity comes only from the server-issued link token.
              google_link_token: signupRequest.googleLinkToken,
            }
          );
        } catch (err) {
          console.error("GOOGLE_SIGNUP_FAILED");
          s.sender(
            "auth/signUpWithGoogleAuth",
            reqId,
            false,
            err?.response?.status
          );
          return;
        }

        if (typeof result?.userId !== "string" || !result.userId.trim()) {
          s.sender("auth/signUpWithGoogleAuth", reqId, false, "INVALID_USER_INFO");
          return;
        }

        const rootDB = await s.databaseService.getRootDatabaseContext();

        // first update user info to local db
        // check if user exists already in local db
        let users = await rootDB.all(
          "SELECT * FROM users WHERE uid = ?;",
          result.userId
        );
        if (users.length === 0) {
          // create new
          await rootDB.run(
            "INSERT INTO users (uid, auth_id, username, auth_encrypted_pw, google_auth_id, google_email, google_profile_image_url, auth_hashed_pw) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
            [
              result.userId,
              result.authId,
              result.username,
              signupRequest.encryptedPassword,
              result.googleAuthId,
              result.googleEmail,
              result.googleProfileImageUrl,
              signupRequest.hashedPassword,
            ]
          );
        } else {
          // update google info (already registered without google)
          await rootDB.run(
            "UPDATE users SET google_auth_id = ?, google_email = ?, google_profile_image_url = ? WHERE uid = ?;",
            [
              result.googleAuthId,
              result.googleEmail,
              result.googleProfileImageUrl,
              result.userId,
            ]
          );
        }

        s.sender("auth/signUpWithGoogleAuth", reqId, true, {
          user: result,
        });
      } catch (err) {
        s.sender("auth/signUpWithGoogleAuth", reqId, false);
        throw err;
      }
    }
  );

  s.register("auth/signUp", async (event, reqId, signupRequest) => {
    try {
      let result;
      try {
        result = await Request.post(appServerFinalEndpoint, "/auth/signup", {
          username: signupRequest.username,
          auth_id: signupRequest.authId,
          encrypted_password: sha256(signupRequest.encryptedPassword),
        });
      } catch (err) {
        s.sender("auth/signUp", reqId, false, err?.response?.status);
        return;
      }

      const uid = result.uid;

      const rootDB = await s.databaseService.getRootDatabaseContext();
      // check if user exists already in local db and register it
      let users = await rootDB.all("SELECT * FROM users WHERE uid = ?;", uid);
      if (users.length === 0) {
        // newly created user
        // need to create secret key to encrypt/decrypt data
        await rootDB.run(
          "INSERT INTO users (uid, auth_id, auth_encrypted_pw, username, auth_hashed_pw) VALUES (?, ?, ?, ?, ?);",
          [
            uid,
            result.auth_id,
            signupRequest.encryptedPassword,
            result.username,
            signupRequest.hashedPassword,
          ]
        );
      } else {
        // user already exists in local db
        let [user] = users;
        if (user.auth_id != null && user.auth_encrypted_pw != null) {
          // already exists in local (but not was in server)
          console.warn(
            "auth/signUp: already exists in local (but newly created in server)"
          );
          if (
            user.auth_id !== signupRequest.authId ||
            user.auth_encrypted_pw !== signupRequest.encryptedPassword
          ) {
            // but info mismatch, automatically update re-create
            console.warn(
              "auth/signUp: info mismatch, automatically update re-create"
            );
            await rootDB.run(
              "UPDATE users SET auth_id = ?, auth_encrypted_pw = ? WHERE uid = ?;",
              [signupRequest.authId, signupRequest.encryptedPassword, uid]
            );
          } else {
            // no need to update
          }
        }

        if (
          user.google_auth_id != null ||
          user.google_email != null ||
          user.google_profile_image_url != null
        ) {
          // google auth exists or remains
          // trying to bind auth to google auth (but there was no google auth in server)
          // delete google auth in local db
          console.warn(
            "auth/signUp: trying to bind auth to google auth (but there was no google auth in server)"
          );
          try {
            await rootDB.run(
              "UPDATE users SET google_auth_id = NULL, google_email = NULL, google_profile_image_url = NULL WHERE uid = ?;",
              [uid]
            );
          } catch (err) {
            // that's ok, maybe next time?
            console.error(err);
          }
          s.sender("auth/signUp", reqId, false, "TRY_TO_BIND_GOOGLE");
          return;
        }

        // already exists in local but wtf is happening?
        // update all anyway
        console.warn(
          "auth/signUp: already exists in local but wtf is happening? (no data in it)"
        );
        await rootDB.run(
          "UPDATE users SET auth_id = ?, auth_encrypted_pw = ? WHERE uid = ?;",
          [signupRequest.authId, signupRequest.encryptedPassword, uid]
        );
      }

      s.sender("auth/signUp", reqId, true);
    } catch (err) {
      s.sender("auth/signUp", reqId, false);
      throw err;
    }
  });

  s.register("auth/login", async (event, reqId, signinRequest) => {
    let canLoginWithLocal = false;
    try {
      const rootDB = await s.databaseService.getRootDatabaseContext();

      // try login in local
      let localUsers = await rootDB.all(
        "SELECT * FROM users WHERE auth_id = ?;",
        signinRequest.authId
      );
      if (localUsers.length > 0) {
        let [localUser] = localUsers;
        if (localUser.auth_encrypted_pw === signinRequest.encryptedPassword) {
          canLoginWithLocal = true;
        }
      }

      let result;
      try {
        result = await Request.post(appServerFinalEndpoint, "/auth/login", {
          auth_id: signinRequest.authId,
          encrypted_password: sha256(signinRequest.encryptedPassword),
        });
      } catch (err) {
        console.warn("LOGIN_REQUEST_FAILED");

        let data = {
          serverStatus: err?.response?.status,
          canLoginWithLocal,
        };

        try {
          if (canLoginWithLocal) {
            let userData = localUsers[0];
            let { uid, username, google_email: googleEmail } = userData;
            data.localUser = { uid, username, googleEmail };
          }
        } catch (err) {
          console.error(err);
        }

        s.sender("auth/login", reqId, false, data);
        return;
      }

      let { auth, user } = result;
      let { access_token, refresh_token } = auth;
      let {
        auth_id,
        uid,
        google_auth_id,
        google_email,
        google_profile_image_url,
      } = user;

      // check if user exists already
      let users = await rootDB.all("SELECT * FROM users WHERE uid = ?;", uid);
      if (users.length === 0) {
        // newly created user
        // need to create secret key to encrypt/decrypt data
        await rootDB.run(
          "INSERT INTO users (uid, auth_id, auth_encrypted_pw, google_auth_id, google_email, google_profile_image_url, access_token, refresh_token, auth_hashed_pw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
          [
            uid,
            auth_id,
            signinRequest.encryptedPassword,
            google_auth_id,
            google_email,
            google_profile_image_url,
            access_token?.token,
            refresh_token?.token,
            signinRequest.hashedPassword,
          ]
        );
      } else {
        let [user] = users;
        // filter null options
        // A row first created by Google sign-in has an empty password hash; fill it now.
        const nullProperties = Object.keys(user).filter(
          (key) => user[key] == null || (key === "auth_hashed_pw" && user[key] === "")
        );
        const newProperties = {
          auth_hashed_pw: signinRequest.hashedPassword,
          auth_id,
          auth_encrypted_pw: signinRequest.encryptedPassword,
          google_auth_id,
          google_email,
          google_profile_image_url,
          access_token: access_token?.token,
          refresh_token: refresh_token?.token,
        };

        if (nullProperties.length > 0) {
          // update null properties
          await rootDB.run(
            `UPDATE users SET ${nullProperties
              .map((key) => `${key} = ?`)
              .join(", ")} WHERE uid = ?;`,
            [...nullProperties.map((key) => newProperties[key]), uid]
          );
        }
      }
      s.sender("auth/login", reqId, true, result);
    } catch (err) {
      s.sender("auth/login", reqId, false, { canLoginWithLocal });
      throw err;
    }
  });

  // The open vault answers these in register() (e2ee/applicationRouting.js): the lists, every
  // change, the sync start and its status. Without an open vault there is no local data, so
  // they are refused. They stay registered: register() only routes registered topics.
  for (const topic of [
    "task/getAllTaskList",
    "task/getAllSubtaskList",
    "category/getCategoryList",
    "tasks_categories/getTasksCategoriesList",
    "task/addTask",
    "task/deleteTask",
    "task/updateTaskOrder",
    "task/updateTaskTitle",
    "task/updateTaskDueDate",
    "task/updateTaskMemo",
    "task/updateTaskDone",
    "task/addTaskCategory",
    "task/deleteTaskCategory",
    "task/updateTaskRepeatPeriod",
    "task/updateTaskImportant",
    "task/duplicateTask",
    // The undo notice's restores (#107).
    "task/restoreTask",
    "task/restoreSubtask",
    "task/undoRecurringCompletion",
    "task/createSubtask",
    "task/deleteSubtask",
    "task/updateSubtaskTitle",
    "task/updateSubtaskDueDate",
    "task/updateSubtaskDone",
    "task/updateSubtaskOrder",
    "category/createCategory",
    "category/deleteCategory",
    "category/deleteCategoryInUse",
    "category/deleteCategoryWithTasks",
    "category/updateCategoryTitle",
    "category/updateCategoryColor",
    "category/updateCategorySecret",
    "category/updateCategoryOrder",
    "device/setDeviceName",
    "socket/connect",
    "system/stateListenReady",
    "auth/isDatabaseReady",
    "sync-v2/getStatus",
    "sync-v2/retry",
  ]) {
    s.register(topic, async (event, reqId) => {
      s.sender(topic, reqId, false, { code: "E2EE_APPLICATION_REQUIRED" });
    });
  }

  /* ---------------------------------------- Test ---------------------------------------- */
  s.register("test_signal", (event, param) => {});
};
