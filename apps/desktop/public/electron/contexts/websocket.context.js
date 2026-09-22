const { v4 } = require("uuid");
const {
  reqIdTag,
  getWebsocketFinalEndpoint,
  getServerFinalEndpoint,
} = require("../modules/util");
const WebSocket = require("ws");
const Request = require("../core/request");
const { getCommonCloseReasonByCode } = require("../util/WebsocketUtil");
const Block = require("../objects/Block");
const TransactionRequest = require("../objects/TransactionRequest");
const { jsonUnmarshal } = require("../util/TxUtil");
const TX_TYPE = require("../constants/TxType.constants");
const Transaction = require("../objects/Transaction");
const axios = require("axios");

const color = console.RGB(190, 75, 255);
const coloredSocket = console.wrap("Websock", color);

class WebsocketContext {
  /**
   * @param userId {string}
   * @param serviceGroup {ServiceGroup}
   */
  constructor(userId, serviceGroup) {
    this.userId = userId;

    this.ipcService = serviceGroup.ipcService;
    this.databaseService = serviceGroup.databaseService;
    this.userService = serviceGroup.userService;
    this.syncerService = serviceGroup.syncerService;
    this.executorService = serviceGroup.executorService;
    this.syncV2Service = serviceGroup.syncV2Service;

    /** @type {WebSocket} */
    this.socket = null;

    this.queue = {};
    this.socketHandlers = {};
    this.messageHandlers = {};
    this.alreadyAuthorized = false;

    this.reconnectTimeoutThread = null;
    this.reconnectTimeout = 500;

    for (const reqId in this.queue) {
      const { timeoutHandler } = this.queue[reqId];
      clearTimeout(timeoutHandler);
    }
  }

  /**
   * @param accessToken {string}
   * @param refreshToken {string}
   * @param reconnect {boolean}
   * @returns {Promise<void>}
   */
  async connect(accessToken, refreshToken, reconnect = false) {
    await this.syncV2Service.restore(this.userId);
    const websocketFinalEndpoint = getWebsocketFinalEndpoint();

    if (!reconnect && this.socket != null) {
      clearTimeout(this.reconnectTimeoutThread);
      console.warn("Socket is already connected. Disconnecting previous...");
      this.disconnect(1000, "Reorganize socket connection");
    }

    // recalculate next reconnect timeout
    if (reconnect) {
      this.reconnectTimeout = this.reconnectTimeout * 2;
      if (this.reconnectTimeout > 10000) this.reconnectTimeout = 10000;
      console.debug("WEBSOCKET_CONTEXT_DEBUG");
    } else {
      this.reconnectTimeout = 500;
      console.debug("WEBSOCKET_CONTEXT_DEBUG");
    }

    if (reconnect === false && this.alreadyAuthorized === true) {
      this.alreadyAuthorized = false;
    }

    let updatedAccessToken;

    try {
      updatedAccessToken = await this.testAuthTokenAndRefresh(
        accessToken,
        refreshToken
      );
    } catch (err) {
      if (err.message === "Unauthorized") {
        console.error(`All auth method failed. Must be re-login.`);
        this.ipcService.sender("system/socketError", null, true, 401);
        return;
      }
      console.error("WEBSOCKET_CONTEXT_ERROR");
      this.reconnectTimeoutThread = setTimeout(() => {
        this.connect(accessToken, refreshToken, true);
      }, this.reconnectTimeout);
      return;
    }

    // Negotiate before entering any legacy sync/overwrite path.
    try {
      const base = getServerFinalEndpoint().replace(/\/v[0-9]+\/?$/, "");
      const { data: caps } = await axios.get(base + "/v2/sync/capabilities", {
        headers: { Authorization: `Bearer ${updatedAccessToken}` },
        timeout: 10000,
      });
      if (caps.protocolVersion !== 2 || !["legacy", "v2"].includes(caps.mode)) {
        throw new Error("UPDATE_REQUIRED");
      }
      if (caps.mode === "v2") {
        await this.syncV2Service.activate(this.userId, updatedAccessToken, caps,
          (token) => this.testAuthTokenAndRefresh(token, null));
        return;
      }
      if (this.syncV2Service.active(this.userId)) throw new Error("ACCOUNT_MODE_REGRESSION");
    } catch (error) {
      this.ipcService.sender("sync-v2/error", null, true, { uid: this.userId, code: "SYNC_NEGOTIATION_FAILED" });
      this.reconnectTimeoutThread = setTimeout(() => {
        this.connect(accessToken, refreshToken, true);
      }, this.reconnectTimeout);
      return;
    }

    // set self-signed certificate false
    console.system("WEBSOCKET_CONTEXT_SYSTEM");
    this.socket = new WebSocket(websocketFinalEndpoint, {
      rejectUnauthorized: false,
      headers: {
        Authorization: `Bearer ${updatedAccessToken}`,
      },
    });

    await this.connectHandler(accessToken, refreshToken);

    /* ---------------------------------------- Default ---------------------------------------- */
    this.alreadyAuthorized = true;
  }

  /**
   * @param accessToken {string}
   * @param refreshToken {string}
   */
  async connectHandler(accessToken, refreshToken) {
    const websocketFinalEndpoint = getWebsocketFinalEndpoint();
    const syncer = await this.syncerService.getUserSyncerContext(this.userId);

    this.on("message", (...arg) => {
      try {
        const [buffer] = arg;
        let raw = buffer.toString();
        const data = JSON.parse(raw);

        // find handlers
        let handlers = this.messageHandlers;
        if (handlers != null && data.topic != null) {
          // formalized data
          const reqId = data.reqId;
          if (reqId == null) {
            console.warn("WEBSOCKET_CONTEXT_WARN");
            return;
          }

          // find on queue
          const queueItem = this.queue[reqId];
          if (queueItem != null) {
            clearTimeout(queueItem.timeoutHandler);
            if (data.success) {
              queueItem?.callback(data.data);
            } else {
              queueItem.errorHandler(new Error(data.err_message));
            }

            delete this.queue[reqId];
            return;
          }

          if (
            handlers[data.topic] != null &&
            typeof handlers[data.topic] === "function"
          ) {
            const handler = handlers[data?.topic];
            handler(data);
          } else {
            console.warn("WEBSOCKET_CONTEXT_WARN");
          }
        } else {
          // raw data
          console.warn("WEBSOCKET_CONTEXT_WARN");
        }
      } catch (err) {
        console.error("WEBSOCKET_CONTEXT_ERROR");
      }
    });

    this.on("open", async () => {
      console.system("WEBSOCKET_CONTEXT_SYSTEM");
      this.ipcService.emiter("socket/connected", null, null);
      const syncer = await this.syncerService.getUserSyncerContext(this.userId);
      if (syncer.stateListenReady) {
        await this.requestLastRemoteBlock();
      }
    });

    this.on("error", (err) => {
      console.error("WEBSOCKET_CONTEXT_ERROR");
      if (err.message.includes("401")) {
        this.ipcService.sender("system/socketError", null, true, 401);
      }
    });

    this.on("close", (code) => {
      const commonReason = getCommonCloseReasonByCode(code);
      console.warn("WEBSOCKET_CONTEXT_WARN");
      this.ipcService.emiter("socket/disconnected", null, { code });

      // reconnect
      console.info("WEBSOCKET_CONTEXT_INFO");
      this.reconnectTimeoutThread = setTimeout(async () => {
        await this.connect(accessToken, refreshToken, true);
      }, this.reconnectTimeout);
    });

    this.onMessage("test", ({ data }) => {
      console.debug("WEBSOCKET_CONTEXT_DEBUG");
    });

    this.onMessage("broadcast_transaction", ({ data: block }) => {
      syncer.saveBlockAndExecute(block);
    });

    this.onMessage("last_block_number", ({ data: lastRemoteBlockNumber }) => {
      syncer.setRemoteLastBlockNumber(lastRemoteBlockNumber);
    });

    this.onMessage("delete_transaction_after", ({ data: blockNumber }) => {
      syncer.handleDeleteTransactionsAfter(blockNumber);
    });
  }

  async requestLastRemoteBlock() {
    try {
      let lastRemoteBlock = await this.sendSync("lastRemoteBlock", null, 10000);
      await this.handleLastRemoteBlock(lastRemoteBlock);
    } catch (err) {
      console.error("WEBSOCKET_CONTEXT_ERROR");
    }
  }

  /**
   * @param code {number}
   * @param reason {string}
   */
  disconnect(code, reason) {
    if (this.socket != null) {
      this.off("close");
      this.socket.close(code, reason);
      this.socket = null;
    }

    this.reconnectTimeout = 500;
    this.queue = {};
    this.messageHandlers = {};
    this.socketHandlers = {};

    clearTimeout(this.reconnectTimeoutThread);
  }

  connected() {
    return this.socket != null && this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * @param accessToken {string}
   * @param refreshToken {string}
   * @returns {Promise<string>}
   */
  async testAuthTokenAndRefresh(accessToken, refreshToken) {
    const appServerFinalEndpoint = getServerFinalEndpoint();
    let accessToken_ = accessToken;
    let refreshToken_ = refreshToken;

    const rootDB = await this.databaseService.getRootDatabaseContext();

    try {
      await Request.post(appServerFinalEndpoint, "/token/test", null, {
        headers: {
          Authorization: `Bearer ${accessToken_}`,
        },
      });
    } catch (err) {
      try {
        let [user] = await rootDB.all(
          `SELECT * FROM users WHERE uid = ?;`,
          this.userId
        );
        if (user == null) throw new Error("User not found");

        if (accessToken_ == null) accessToken_ = user.access_token ?? null;
        if (refreshToken_ == null) refreshToken_ = user.refresh_token ?? null;
      } catch (err) {
        console.error("WEBSOCKET_CONTEXT_ERROR");
      }

      // if error is 401, then try refresh token
      console.debug("WEBSOCKET_CONTEXT_DEBUG");
      if (
        err?.response?.status === 401 &&
        refreshToken_ != null &&
        refreshToken_ !== ""
      ) {
        try {
          console.info(
            "Trying to refresh access/refresh token (values omitted)"
          );
          let result = await Request.post(
            appServerFinalEndpoint,
            "/auth/refreshToken",
            null,
            {
              headers: {
                Authorization: `Bearer ${accessToken_}`,
                "X-Refresh-Token": refreshToken_,
              },
              withCredentials: true,
            }
          );
          let { access_token, refresh_token } = result;

          accessToken_ = access_token.token;
          refreshToken_ = refresh_token.token;

          // register updated tokens on local
          await rootDB.run(
            `UPDATE users SET access_token = ?, refresh_token = ? WHERE uid = ?;`,
            [accessToken_, refreshToken_, this.userId]
          );

          // update access token & refresh token to ipc
          this.ipcService.sender("auth/tokenUpdated", null, true, {
            accessToken: accessToken_,
            refreshToken: refreshToken_,
          });
        } catch (err) {
          console.error("Token refresh failed; status:");

          // refresh failed: must re-login
          throw new Error("Unauthorized");
        }
      } else {
        throw new Error(err?.response?.status ?? err?.message);
      }
    }
    this.alreadyAuthorized = true;
    return accessToken_;
  }

  async handleLastRemoteBlock(lastRemoteBlock) {
    const { number: remoteLastBlockNumber } = lastRemoteBlock;

    const syncer = await this.syncerService.getUserSyncerContext(this.userId);
    const db = await this.databaseService.getUserDatabaseContext(this.userId);

    console.info("WEBSOCKET_CONTEXT_INFO");
    syncer.setRemoteLastBlockNumber(remoteLastBlockNumber);

    // local last block number
    let localLastBlockNumber = await syncer.getLocalLastBlockNumber();
    console.info("WEBSOCKET_CONTEXT_INFO");
    let commonBlockNumber = Math.min(
      localLastBlockNumber,
      remoteLastBlockNumber
    );

    if (commonBlockNumber === 0) {
      const remoteZeroBlockHash = await syncer.getRemoteBlockHash(0);
      // test local empty hash
      let zeroBlock = Block.emptyBlock();
      if (zeroBlock.hash !== remoteZeroBlockHash) {
        console.error("WEBSOCKET_CONTEXT_ERROR");
        throw new Error("Initial hash mismatch");
      } else {
        console.debug("WEBSOCKET_CONTEXT_DEBUG");
      }
    } else if (commonBlockNumber > 0) {
      let lastCommonLocalBlockHash = await syncer.getLocalBlockHash(
        commonBlockNumber
      );
      let lastCommonRemoteBlockHash = await syncer.getRemoteBlockHash(
        commonBlockNumber
      );

      // Mismatched occurred :: check mismatch of blockchain
      if (lastCommonLocalBlockHash !== lastCommonRemoteBlockHash) {
        // fuzzy state :: don't check mismatch, just sync with latest (v0.2.2)
        const justSync = true;

        if (justSync) {
          console.warn("WEBSOCKET_CONTEXT_WARN");
          // last common mismatch, need to find un-dirty block
          let oldestLocalBlockNumber = await syncer.getOldestLocalBlockNumber();
          if (oldestLocalBlockNumber == null) {
            throw new Error("Cannot find oldest local block number");
          }

          console.info("WEBSOCKET_CONTEXT_INFO");
          const mismatchStartBlockNumber =
            await syncer.findBlockHashMismatchStartNumber(
              oldestLocalBlockNumber,
              commonBlockNumber
            );
          if (mismatchStartBlockNumber == null) {
            throw new Error("Cannot find mismatch start block number");
          }

          // my latest block
          const localLastBlock = await syncer.getLocalBlock(
            localLastBlockNumber
          );
          const remoteLastBlock = await syncer.getRemoteBlock(
            remoteLastBlockNumber
          );

          const localLastBlockTime = localLastBlock.timestamp;
          const remoteLastBlockTime = remoteLastBlock.updates.srcTx.timestamp;

          if (localLastBlockTime > remoteLastBlockTime) {
            console.warn(
              `Local block is newer than remote, so choose local blocks to upload`
            );
            // overwrite server with local blocks
            await syncer.overwriteRemoteStateWithLocal(
              mismatchStartBlockNumber,
              localLastBlockNumber
            );
          } else if (localLastBlockTime < remoteLastBlockTime) {
            console.warn(
              `Remote block is newer than local, so choose remote blocks to upload`
            );
            // overwrite local with remote blocks
            await syncer.overwriteLocalStateWithRemote(remoteLastBlockNumber);
          } else {
            // blocks uploaded at same time, choose longer one
            if (localLastBlockNumber > remoteLastBlockNumber) {
              console.warn(
                `Local chain is longer than remote, so choose local blocks to upload`
              );
              // overwrite server with local blocks
              await syncer.overwriteRemoteStateWithLocal(
                mismatchStartBlockNumber,
                localLastBlockNumber
              );
            } else {
              console.warn(
                `Remote chain is longer or same as local, so choose remote blocks to upload`
              );
              // overwrite local with remote blocks
              await syncer.overwriteLocalStateWithRemote(remoteLastBlockNumber);
            }
          }
        } else {
          console.warn("WEBSOCKET_CONTEXT_WARN");
          // last common mismatch, need to find un-dirty block
          let oldestLocalBlockNumber = await syncer.getOldestLocalBlockNumber();
          if (oldestLocalBlockNumber == null) {
            throw new Error("Cannot find oldest local block number");
          }

          console.info("WEBSOCKET_CONTEXT_INFO");
          const mismatchStartBlockNumber =
            await syncer.findBlockHashMismatchStartNumber(
              oldestLocalBlockNumber,
              commonBlockNumber
            );
          if (mismatchStartBlockNumber == null) {
            throw new Error("Cannot find mismatch start block number");
          }

          // recover mismatch blocks
          this.ipcService.sender("system/mismatchTxHashFound", null, true, {
            mismatchStartBlockNumber,
            mismatchEndBlockNumber: commonBlockNumber,
            lossAfterAcceptTheirs:
              localLastBlockNumber >= mismatchStartBlockNumber
                ? localLastBlockNumber - mismatchStartBlockNumber + 1
                : 0,
            lossAfterAcceptMine:
              remoteLastBlockNumber >= mismatchStartBlockNumber
                ? remoteLastBlockNumber - mismatchStartBlockNumber + 1
                : 0,
          });
          throw new Error(
            `Mismatch block hash found at block number ${mismatchStartBlockNumber}~${commonBlockNumber}`
          );
        }
      }
    }

    if (localLastBlockNumber < remoteLastBlockNumber) {
      // sync blocks needed (local is behind)
      console.info(`Local block number is behind remote, syncing...`);
      let txCountToSync = remoteLastBlockNumber - localLastBlockNumber;
      const snapSyncTolerance = 0; // originally 20, but disabled (for a while)
      if (txCountToSync > snapSyncTolerance) {
        // snap sync
        console.debug("WEBSOCKET_CONTEXT_DEBUG");
        // await syncer.snapSync(remoteLastBlockNumber);
        await syncer.applySnapshot(remoteLastBlockNumber); // this is fastest (maybe?)
      } else {
        // full sync
        console.debug("WEBSOCKET_CONTEXT_DEBUG");
        await syncer.fullSync(localLastBlockNumber + 1, remoteLastBlockNumber);
      }
    } else if (localLastBlockNumber > remoteLastBlockNumber) {
      // commit blocks needed (local is ahead)
      console.info("WEBSOCKET_CONTEXT_INFO");
      // upload database snapshot to remote
      const db = await this.databaseService.getUserDatabaseContext(this.userId);
      const txContent = await db.getDatabaseSnapshot();
      const tx = this.executorService.makeTransaction(
        TX_TYPE.INITIALIZE,
        txContent,
        localLastBlockNumber
      );
      await syncer.sendTransaction(tx);
    } else {
      // no sync needed (already synced)
      console.info("WEBSOCKET_CONTEXT_INFO");
    }
  }

  /* ------------------------- Internal ------------------------- */
  /**
   * @param topic {string}
   * @param data? {any}
   * @param timeout? {number}
   * @returns {Promise<unknown>}
   */
  async sendSync(topic, data = null, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const reqId = v4();
      const packet = { topic, data, reqId };
      const callback = (data) => {
        let dataStr = JSON.stringify(data);
        if (dataStr.length > 5000) {
          dataStr = dataStr.substring(0, 5000) + "...";
        }
        console.info("WEBSOCKET_CONTEXT_INFO");
        resolve(data);
      };
      const errorHandler = (err) => {
        console.info("WEBSOCKET_CONTEXT_INFO");
        reject(err);
      };

      let timeoutHandler = setTimeout(() => {
        console.info("WEBSOCKET_CONTEXT_INFO");
        reject(`Request timeout`);
      }, timeout);

      this.queue[reqId] = { callback, errorHandler, timeoutHandler };

      const packetJson = JSON.stringify(packet);

      try {
        this.socket.send(packetJson);
      } catch (err) {
        console.error("WEBSOCKET_CONTEXT_ERROR");
        reject(err);
      }

      console.info("WEBSOCKET_CONTEXT_INFO");
    });
  }

  send(topic, data) {
    if (!this.connected()) {
      console.warn("Socket is not connected, message not sent");
      return;
    }
    const reqId = v4();
    const packet = { topic, data, reqId };
    const packetJson = JSON.stringify(packet);

    try {
      this.socket.send(packetJson);
    } catch (err) {
      console.error("WEBSOCKET_CONTEXT_ERROR");
    }

    console.info("WEBSOCKET_CONTEXT_INFO");
  }

  on(topic, callback) {
    const newCallback = (...args) => {
      // console.info(
      //   `${coloredSocket} ${console.wrap(`<-${reqIdTag(reqId)}--`,console.GREEN)} ${console.wrap(topic, console.MAGENTA)} ${data}`
      // );
      return callback(...args);
    };
    if (this.socketHandlers[topic] == null) {
      this.socketHandlers[topic] = [];
    }
    this.socketHandlers[topic].push(newCallback);
    this.socket.on(topic, newCallback);
  }

  off(topic) {
    if (this.socket != null) {
      if (this.socketHandlers[topic] != null) {
        for (const callback of this.socketHandlers[topic]) {
          this.socket.off(topic, callback);
        }
      }
    }
  }

  onMessage(topic, callback) {
    if (this.socket == null) {
      console.warn("Socket is not connected, message couldn't be received");
      return;
    }

    const newCallback = (data) => {
      const success = data?.success;
      const reqId = data?.reqId;

      if (success) {
        console.info("WEBSOCKET_CONTEXT_INFO");
      } else {
        console.info("WEBSOCKET_CONTEXT_INFO");
      }

      if (success) {
        return callback(data);
      }
    };

    if (this.messageHandlers == null) this.messageHandlers = {};
    this.messageHandlers[topic] = newCallback;
  }
}

module.exports = WebsocketContext;
