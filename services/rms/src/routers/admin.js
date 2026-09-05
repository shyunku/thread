const express = require("express");
const fs = require("fs");
const util = require("../utils/util");
const router = express.Router();
const path = require("path");
const resolver = require("../utils/expressResolver");
const db = require("../modules/mysql");
const axios = require("axios");
const DiskUsage = require("diskusage");
const chunkUpload = require("../modules/chunkUpload");

const getReleaseDirPath = () =>
  path.resolve(process.env.PWD || process.cwd(), "releases");

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
                link: `/default/release?version=${encodeURIComponent(version)}&category=${encodeURIComponent(category)}`,
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

  const authorization = req.get("Authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    resolver.fail(res, 401, null, "관리자 로그인이 필요합니다.");
    return;
  }

  try {
    const { APP_SERVER_ENTRY } = process.env;
    const url = `${APP_SERVER_ENTRY}/v1/admin/alert-new-version`;
    let result = await axios.post(url, { version }, {
      headers: { Authorization: authorization },
      timeout: 10000,
    });
    await db.query(`UPDATE version_master SET alerted=true WHERE version=?`, [version]);
    resolver.ok(res, result.data);
  } catch (err) {
    const status = err.response?.status;
    console.error("Release alert failed", status || err.code || "unknown");
    const authFailure = status === 401 || status === 403;
    resolver.fail(res, authFailure ? status : 300, null,
      authFailure ? "관리자 인증이 만료되었거나 권한이 없습니다. 다시 로그인해주세요."
        : "알림 요청을 처리하지 못했습니다. API 연결 상태를 확인해주세요.");
  }
});

router.put("/release/chunk", async (req, res) => {
  let metadata;

  try {
    metadata = chunkUpload.parseChunkMetadata(req.query);
  } catch (err) {
    resolver.fail(res, 400, null, err.message);
    return;
  }

  let receivedFile = false;
  req.pipe(req.busboy);

  req.busboy.on("file", (fieldName, file) => {
    if (receivedFile) {
      file.resume();
      return;
    }
    receivedFile = true;

    chunkUpload
      .storeChunk(getReleaseDirPath(), file, metadata)
      .then((size) => {
        if (!res.headersSent) {
          resolver.ok(res, { chunk_index: metadata.chunkIndex, size });
        }
      })
      .catch((err) => {
        console.error(err);
        if (!res.headersSent) resolver.fail(res, 300, null, err.message);
      });
  });

  req.busboy.on("finish", () => {
    if (!receivedFile && !res.headersSent) {
      resolver.fail(res, 400, null, "Chunk file not found");
    }
  });

  req.busboy.on("error", (err) => {
    console.error(err);
    if (!res.headersSent) resolver.fail(res, 300, null, err.message);
  });
});

router.post("/release/complete", async (req, res) => {
  try {
    const result = await chunkUpload.combineChunks(
      getReleaseDirPath(),
      req.query.upload_id
    );
    await db.query(`UPDATE version_master SET ${result.category}=? WHERE version=?;`, [
      true,
      result.version,
    ]);
    resolver.ok(res, {
      version: result.version,
      category: result.category,
      filename: result.filename,
      size: result.fileSize,
    });
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300, null, err.message);
  }
});

router.delete("/release/chunks", async (req, res) => {
  try {
    await chunkUpload.abortUpload(getReleaseDirPath(), req.query.upload_id);
    resolver.ok(res);
  } catch (err) {
    console.error(err);
    resolver.fail(res, 400, null, err.message);
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
    // releases/1.0.0/alpha/win/thread 1.0.0.exe
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
