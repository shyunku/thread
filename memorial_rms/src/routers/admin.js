const express = require("express");
const fs = require("fs");
const util = require("../utils/util");
const router = express.Router();
const path = require("path");
const pbip = require("public-ip");
const queryString = require("query-string");
const resolver = require("../utils/expressResolver");
const db = require("../modules/mysql");
const axios = require("axios");
const DiskUsage = require("diskusage");

const serverPort = process.env.SERVER_PORT;

router.get("/disk-status", async (req, res) => {
  DiskUsage.check("/", (err, info) => {
    if (err) {
      console.error(err);
      return;
    }
    resolver.ok(res, info);
  });
});

router.get("/versions", async (req, res) => {
  try {
    let versionInfoBundle = await db.query("SELECT * FROM version_master;");

    let versionInfoMap = versionInfoBundle.reduce((acc, cur) => {
      acc[cur.version] = cur;
      return acc;
    }, {});

    const rootPath = process.env.PWD;
    const releaseDirPath = path.resolve(rootPath, "releases");
    const ipv4 = await pbip.v4();

    for (let version in versionInfoMap) {
      const versionInfo = versionInfoMap[version];

      const versionPath = path.resolve(releaseDirPath, version);

      if (fs.existsSync(versionPath)) {
        let [folder] = fs.readdirSync(versionPath);
        versionInfo.isBeta = folder !== "alpha";

        const flagPath = path.resolve(versionPath, folder);
        let categories = fs.readdirSync(flagPath);

        versionInfo.releases = [];

        for (let category of categories) {
          const categoryPath = path.resolve(flagPath, category);
          const files = fs.readdirSync(categoryPath);

          if (files.length > 0) {
            let [file] = files;

            if (versionInfo[category]) {
              versionInfo.releases.push({
                category,
                filename: file,
                link: `http://${ipv4}:${serverPort}/default/release?version=${version}&category=${category}`,
              });
            }
          }
        }
      }
    }

    const assembledVersions = Object.values(versionInfoMap);

    resolver.ok(res, assembledVersions);
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300);
  }
});

router.get("/alerted-latest-version", async (req, res) => {
  try {
    let alertedLatestVersionResult = await db.query(`
            SELECT * FROM version_master WHERE verified=true AND alerted=true ORDER BY updated_timestamp DESC LIMIT 1;
        `);

    if (alertedLatestVersionResult.length > 0) {
      let [latestAlertedVersionInfo] = alertedLatestVersionResult;
      resolver.ok(res, latestAlertedVersionInfo);
    } else {
      resolver.ok(res, null);
    }
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300);
  }
});

router.post("/alert-new-version", async (req, res) => {
  if (
    !util.validateField(req.body, { version: "" }, (errMsg) => {
      resolver.fail(res, 400, null, errMsg);
    })
  )
    return;

  const { version } = req.body;

  try {
    const { APP_SERVER_ENTRY } = process.env;
    const url = `${APP_SERVER_ENTRY}/v1/admin/alert-new-version`;
    let result = await axios.post(url, { version });
    await db.query(`UPDATE version_master SET alerted=true WHERE version=?`, [version]);
    resolver.ok(res, result.data);
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300);
  }
});

router.put("/release", async (req, res) => {
  if (
    !util.validateField(req.query, { version: "", category: "", beta: "" }, (errMsg) => {
      resolver.fail(res, 400, null, errMsg);
    })
  )
    return;

  let uploadedPath, fileStream;
  let { version, category, beta } = req.query;

  try {
    // releases/1.0.0/alpha/win/memorial 1.0.0.exe
    const isBeta = beta == "true";
    const rootPath = process.env.PWD;
    const releaseDirPath = path.resolve(rootPath, "releases");
    const versionPath = path.resolve(releaseDirPath, version);
    const flagPath = path.resolve(versionPath, isBeta ? "beta" : "alpha");
    const categoryPath = path.resolve(flagPath, category);

    if (!fs.existsSync(releaseDirPath)) {
      fs.mkdirSync(releaseDirPath);
    }

    if (!fs.existsSync(versionPath)) {
      fs.mkdirSync(versionPath);
    }

    if (!fs.existsSync(flagPath)) {
      fs.mkdirSync(flagPath);
    }

    if (!fs.existsSync(categoryPath)) {
      fs.mkdirSync(categoryPath);
    }

    let files = fs.readdirSync(categoryPath);
    for (let file of files) {
      const remainFilepath = path.resolve(categoryPath, file);
      console.debug(`Delete ${remainFilepath}`);
      fs.rmSync(remainFilepath);
    }

    req.pipe(req.busboy);
    req.busboy.on("file", (fieldName, file, fileInfo) => {
      const filename = fileInfo.filename;
      console.debug("uploading " + filename);

      const filepath = path.resolve(categoryPath, filename);
      uploadedPath = filepath;

      fileStream = fs.createWriteStream(filepath);
      file.pipe(fileStream);
      fileStream.on("close", async () => {
        console.debug("upload done");

        await db.query(`UPDATE version_master SET ${category}=? WHERE version=?;`, [true, version]);

        resolver.ok(res);
      });
    });
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300);
    try {
      if (fileStream) fileStream.end();
      // delete file if exists
      if (uploadedPath && fs.existsSync(uploadedPath)) fs.rmSync(uploadedPath);
      await db.query(`UPDATE version_master SET ${category}=? WHERE version=?;`, [false, version]);
    } catch (err) {
      console.error(err);
    }
  }
});

router.delete("/release", async (req, res) => {
  if (
    !util.validateField(req.query, { version: "", category: "", beta: "" }, (errMsg) => {
      resolver.fail(res, 400, null, errMsg);
    })
  )
    return;

  try {
    let { version, category, beta } = req.query;

    const isBeta = beta == "true";
    const rootPath = process.env.PWD;
    const releaseDirPath = path.resolve(rootPath, "releases");
    const versionPath = path.resolve(releaseDirPath, version);
    const flagPath = path.resolve(versionPath, isBeta ? "beta" : "alpha");
    const categoryPath = path.resolve(flagPath, category);

    if (fs.existsSync(categoryPath)) {
      let files = fs.readdirSync(categoryPath);
      for (let file of files) {
        const remainFilepath = path.resolve(categoryPath, file);
        fs.rmSync(remainFilepath);

        await db.query(`UPDATE version_master SET ${category}=? WHERE version=?;`, [false, version]);
      }
    }

    if (fs.existsSync(versionPath)) {
      let fileCount = 0;
      let flags = fs.readdirSync(versionPath);

      for (let flag of flags) {
        let _flagPath = path.resolve(versionPath, flag);
        let categories = fs.readdirSync(_flagPath);

        for (let _category of categories) {
          const _categoryPath = path.resolve(_flagPath, _category);
          const files = fs.readdirSync(_categoryPath);

          fileCount += files.length;
        }
      }

      if (fileCount === 0) {
        console.debug("no remaining");
        fs.rmSync(versionPath, { recursive: true, force: true });
      }
    }

    resolver.ok(res);
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300);
  }
});

router.put("/version", async (req, res) => {
  if (
    !util.validateField(req.body, { version: "", beta: false, update_time: 0, verified: false }, (errMsg) => {
      resolver.fail(res, 400, null, errMsg);
    })
  )
    return;

  const { version, beta, update_time, verified } = req.body;

  try {
    await db.query(
      "INSERT INTO version_master(version, updated_timestamp, final_edit_timestamp, beta, verified) VALUES(?, ?, ?, ?, ?);",
      [version, update_time, update_time, beta, verified]
    );

    resolver.ok(res);
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300);
  }
});

router.post("/version", async (req, res) => {
  if (
    !util.validateField(req.body, { version: "", beta: false, update_time: 0, verified: false }, (errMsg) => {
      resolver.fail(res, 400, null, errMsg);
    })
  )
    return;

  const { version, beta, update_time, verified } = req.body;

  try {
    await db.query(
      "UPDATE version_master SET beta=?, verified=?, final_edit_timestamp=?, updated_timestamp=? WHERE version=?;",
      [beta, verified, Date.now(), update_time, version]
    );

    resolver.ok(res);
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300);
  }
});

router.delete("/version", async (req, res) => {
  if (
    !util.validateField(req.query, { version: "" }, (errMsg) => {
      resolver.fail(res, 400, null, errMsg);
    })
  )
    return;

  const { version } = req.query;

  try {
    const rootPath = process.env.PWD;
    const releaseDirPath = path.resolve(rootPath, "releases");
    const versionPath = path.resolve(releaseDirPath, version);

    if (fs.existsSync(versionPath)) {
      fs.rmSync(versionPath, { recursive: true, force: true });
    }

    await db.query("DELETE FROM version_master WHERE version = ?;", [version]);

    resolver.ok(res);
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300);
  }
});

module.exports = router;
