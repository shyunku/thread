const FileSystem = require("../modules/filesystem");
const packageJson = require("../../../package.json");
const path = require("path");
const fs = require("fs");
const DatabaseContext = require("../contexts/database.context");

class DatabaseService {
  constructor() {
    this.rootDatabaseContext = null;
    this.rootDatabaseReadyPromise = null;

    /** @type {ServiceGroup} */
    this.serviceGroup = null;
  }

  /**
   * @param serviceGroup {ServiceGroup}
   */
  inject(serviceGroup) {
    this.serviceGroup = serviceGroup;
  }

  /**
   * @returns {Promise<DatabaseContext>}
   */
  async getRootDatabaseContext() {
    if (this.rootDatabaseContext != null) return this.rootDatabaseContext;
    if (this.rootDatabaseReadyPromise == null) {
      this.rootDatabaseReadyPromise = (async () => {
        const context = new DatabaseContext();
        await context.initializeAsRoot();
        this.rootDatabaseContext = context;
        return context;
      })().finally(() => { this.rootDatabaseReadyPromise = null; });
    }
    return this.rootDatabaseReadyPromise;
  }

  // Account deletion (#92): removes this account's plaintext databases older versions left
  // (datafiles/v1..vN and datafiles/sync-v2). Other accounts' files stay.
  async removeUserDatabases(userId) {
    if (typeof userId !== "string" || !userId || userId.length > 256 || /[\\/:\0]/.test(userId) || userId.includes(".."))
      throw new Error("User ID is not valid.");
    const datafileDirPath = path.join(FileSystem.getUserDataPath(), "datafiles");
    const bases = [path.join(datafileDirPath, "sync-v2", "user-" + encodeURIComponent(userId) + ".sqlite3")];
    for (let version = 1; version <= Number(packageJson.config["scheme_version"]); version++)
      bases.push(path.join(datafileDirPath, "v" + version, `user-${userId}.sqlite3`));
    for (const base of bases) {
      for (const file of [base, base + "-wal", base + "-shm", base + "-journal"]) {
        try { fs.rmSync(file, { force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
      }
    }
  }
}

module.exports = DatabaseService;
