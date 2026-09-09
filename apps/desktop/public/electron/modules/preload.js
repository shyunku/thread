// Keep this file self-contained: sandboxed preloads cannot require local modules.
// Main imports the same contract; renderer executes only the bridge installation.
const REQUEST_TOPICS = Object.freeze([
  "vault/getStatus", "vault/create", "vault/unlock", "vault/lock", "vault/intakes", "vault/reviews",
  "system/subscribe",
  "system/terminate_signal",
  "system/relaunch",
  "system/maximize_window",
  "system/minimize_window",
  "system/restore_window",
  "system/close_window",
  "system/isMaximizable",
  "system/modal",
  "system/modeless",
  "system/inner-modal",
  "system/close-inner-modal",
  "system/computer_idle_time",
  "system/setAsHomeWindow",
  "system/setAsLoginWindow",
  "system/lastTxUpdateTime",
  "system/localLastBlockNumber",
  "system/remoteLastBlockNumber",
  "system/isDatabaseClear",
  "system/isLegacyMigrationAvailable",
  "system/migrateLegacyDatabase",
  "system/truncateLegacyDatabase",
  "system/migrateCheckDoneSignal",
  "system/mismatchTxAcceptTheirs",
  "system/mismatchTxAcceptMine",
  "system/initializeState",
  "system/clearStatePermanently",
  "system/stateListenReady",
  "auth/sendGoogleOauthResult",
  "auth/registerAuthInfoSync",
  "auth/deleteAuthInfo",
  "auth/loadAuthInfoSync",
  "auth/isDatabaseReady",
  "auth/initializeDatabase",
  "auth/signUpWithGoogleAuth",
  "auth/signUp",
  "auth/login",
  "socket/connect",
  "socket/disconnect",
  "task/getAllTaskList",
  "task/getAllSubtaskList",
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
  "task/createSubtask",
  "task/deleteSubtask",
  "task/updateSubtaskTitle",
  "task/updateSubtaskDueDate",
  "task/updateSubtaskDone",
  "category/getCategoryList",
  "category/createCategory",
  "category/deleteCategory",
  "category/checkCategoryPassword",
  "category/updateCategoryTitle",
  "category/getCategoryTasks",
  "category/updateCategoryColor",
  "tasks_categories/getTasksCategoriesList",
  "sync-v2/getStatus",
  "sync-v2/retry",
  "release-alert/get",
  "release-alert/download",
  "release-alert/showFile",
  "update_check@continue"
]);
const EVENT_TOPICS = Object.freeze([
  "vault/status",
  "inner-modal",
  "close-inner-modal",
  "isMaximizable",
  "win_state_changed",
  "__window_param__",
  "auth/tokenUpdated",
  "socket/connected",
  "socket/disconnected",
  "transaction/error",
  "system/mismatchTxHashFound",
  "system/snapshotApplied",
  "system/stateRollback",
  "system/socketError",
  "system/error",
  "state/transitions",
  "sync-v2/state",
  "sync-v2/status",
  "sync-v2/error",
  "release-alert/available",
  "release_download@initial",
  "release_download@state",
  "release_download@done",
  "release_download@skip",
  "release_install@state",
  "update_check@failed"
]);
const UPDATE_EVENTS = Object.freeze(EVENT_TOPICS.filter(topic =>
  topic.startsWith("release_download@") || topic === "release_install@state" ||
  topic === "update_check@failed"));
const canReceive = topic => REQUEST_TOPICS.includes(topic) || EVENT_TOPICS.includes(topic);

if (process.type === "renderer") {
  const { contextBridge, ipcRenderer } = require("electron");
  // No privileged API in subframes or in remotely opened OAuth windows.
  if (process.isMainFrame) {
    const requests = {};
    for (const topic of REQUEST_TOPICS) {
      requests[topic] = (...args) => ipcRenderer.send(topic, ...args);
    }
    contextBridge.exposeInMainWorld("thread", Object.freeze({
      isDevelopment: process.env.NODE_ENV !== "production",
      requests: Object.freeze(requests),
      listen(topic, callback) {
        if (!canReceive(topic) || typeof callback !== "function")
          throw new Error("IPC_CHANNEL_NOT_ALLOWED");
        // Never expose IpcRendererEvent.sender or other Electron objects.
        const handler = (_event, ...args) => callback(...args);
        ipcRenderer.on(topic, handler);
        return () => ipcRenderer.removeListener(topic, handler);
      },
    }));
  }
} else {
  module.exports = { REQUEST_TOPICS, EVENT_TOPICS, UPDATE_EVENTS, canReceive };
}
