const packageJson = require("../../../package.json");
const path = require("path");
const sqlite3 = require("sqlite3");
const { migrate } = require("../migrations/schema");
const FileSystem = require("../modules/filesystem");
const fs = require("fs");
const { getBuildLevel } = require("../util/SystemUtil");
const { getUserDataPath } = require("../modules/filesystem");

const COLOR = console.RGB(78, 119, 138);
const TAG = console.wrap("IpcMain", COLOR);

class DatabaseContext {
  constructor() {
    /** @type {sqlite3.Database} */
    this.db = null;
  }

  /**
   * @returns {Promise<void>}
   */
  async initializeAsRoot() {
    console.info("Initializing Root Database...");

    const userDataPath = getUserDataPath();
    const appResourcePath = FileSystem.getAppResourcesPath();
    const rootSchemeVersion = "v" + packageJson.config["root_scheme_version"];

    let datafileDirPath = path.join(userDataPath, "datafiles");
    let rootDatabaseTemplatePath = path.join(appResourcePath, "root.sqlite3");
    let rootDatabaseFileName = `root-${rootSchemeVersion}.sqlite3`;
    let rootDatabaseFilePath = path.join(datafileDirPath, rootDatabaseFileName);

    if (!fs.existsSync(datafileDirPath)) {
      console.warn(`Datafile directory doesn't exists, newly create.`);
      fs.mkdirSync(datafileDirPath);
    }

    if (!fs.existsSync(rootDatabaseFilePath)) {
      console.warn(
        `Root Database file (${rootSchemeVersion}) doesn't exists, newly create (${rootDatabaseTemplatePath} -> ${rootDatabaseFilePath})`
      );
      fs.copyFileSync(rootDatabaseTemplatePath, rootDatabaseFilePath);
    }

    return this.openAndMigrate(rootDatabaseFilePath, "root");
  }

  async openAndMigrate(databaseFilePath, scope) {
    await new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(databaseFilePath,
        (error) => error ? reject(error) : resolve());
    });
    try {
      const result = await migrate(this.db, scope, databaseFilePath);
      console.info(`Database ready: ${scope} schema ${result.version}`);
    } catch (error) {
      await new Promise((resolve) => this.db.close(() => resolve()));
      this.db = null;
      throw error;
    }
  }

  get(query, ...args) {
    console.system(
      `${TAG} ${console.wrap(`<-[GET]->`, console.BLUE)} ${console.wrap(
        "sqlite3: " + query,
        console.YELLOW
      )} ${args.join(", ")}`
    );
    let params = Array.isArray(args?.[0]) ? args[0] : args;
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async run(query, ...args) {
    console.system(
      `${TAG} ${console.wrap(`--[RUN]->`, console.BLUE)} ${console.wrap(
        "sqlite3: " + query,
        console.YELLOW
      )} ${args.map((e) => e ?? null).join(", ")}`
    );
    let params = Array.isArray(args?.[0]) ? args[0] : args;
    return new Promise((resolve, reject) => {
      this.db.run(query, params, function (err) {
        if (err) {
          console.system(
            `IpcMain ${console.wrap(`X-[RES]--`, console.RED)} ${console.wrap(
              `sqlite3`,
              console.RED
            )} Run failed: ${err}`
          );
          reject(err);
        } else {
          console.system(
            `IpcMain ${console.wrap(`<-[RES]--`, console.BLUE)} ${console.wrap(
              `[${this.changes ?? "-"} row(s) affected]`,
              console.GREEN
            )}`
          );
          resolve(this);
        }
      });
    });
  }

  /**
   *
   * @param query
   * @param args
   * @returns {Promise<any[]>}
   */
  all(query, ...args) {
    console.system(
      `${TAG} ${console.wrap(`<-[ALL]->`, console.BLUE)} ${console.wrap(
        "sqlite3: " + query,
        console.YELLOW
      )} ${args.map((e) => e ?? null).join(", ")}`
    );
    let params = Array.isArray(args?.[0]) ? args[0] : args;
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  begin() {
    console.system(
      `${TAG} ${console.wrap(`--[BEG]->`, console.BLUE)} ${console.wrap(
        "sqlite3: begin transaction;",
        console.ORANGE
      )}`
    );
    return new Promise((resolve, reject) => {
      this.db.run("BEGIN", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  commit() {
    console.system(
      `${TAG} ${console.wrap(`--[COM]->`, console.BLUE)} ${console.wrap(
        "sqlite3: commit transactions",
        console.ORANGE
      )}`
    );
    return new Promise((resolve, reject) => {
      this.db.run("COMMIT", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  rollback() {
    console.system(
      `${TAG} ${console.wrap(`--[ROL]-|`, console.BLUE)} ${console.wrap(
        "sqlite3: rollback transactions",
        console.ORANGE
      )}`
    );
    return new Promise((resolve, reject) => {
      this.db.run("ROLLBACK", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close() {
    new Promise((resolve, reject) =>
      this.db.close((err) => {
        if (err) reject(err);
        this.db = null;
        resolve();
      })
    );
  }
}

module.exports = DatabaseContext;
