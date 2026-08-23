const express = require("express");
const fs = require("fs");
const util = require("../utils/util");
const router = express.Router();
const path = require("path");
const resolver = require("../utils/expressResolver");
const db = require("../modules/mysql");

router.get("/latest-version", async (req, res) => {
  try {
    let category = req.query.category;
    let onlyVerified = req.query.only_verified == "true";
    let excludeBeta = (req.query.exclude_beta ?? "false") == "true";
    let result;

    const whereClauses = [];
    if (excludeBeta) whereClauses.push(`beta=false`);
    if (category) whereClauses.push(`${category}=true`);
    if (onlyVerified) whereClauses.push(`verified=true`);

    const whereStatements = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    result = await db.query(`SELECT * FROM version_master ${whereStatements} ORDER BY updated_timestamp DESC LIMIT 1;`);

    if (result.length > 0) {
      let sortedVersions = result.sort((a, b) => b.updated_timestamp - a.updated_timestamp);
      const selectedSortedVersionInfo = sortedVersions[0];
      resolver.ok(res, selectedSortedVersionInfo);
    } else {
      resolver.fail(res, 313);
    }
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300);
  }
});

router.get("/release", async (req, res) => {
  if (
    !util.validateField(req.query, { version: "", category: "" }, (errMsg) => {
      resolver.fail(res, 400, null, errMsg);
    })
  )
    return;

  try {
    let { version, category } = req.query;

    const rootPath = process.env.PWD;
    const releaseDirPath = path.resolve(rootPath, "releases");
    const versionPath = path.resolve(releaseDirPath, version);

    if (fs.existsSync(versionPath)) {
      let [folder] = fs.readdirSync(versionPath);
      const flagPath = path.resolve(versionPath, folder);
      const categoryPath = path.resolve(flagPath, category);

      let files = fs.readdirSync(categoryPath);
      if (files.length > 0) {
        let [file] = files;
        const filePath = path.resolve(categoryPath, file);
        await db.query(`UPDATE version_master SET download_count=download_count+1 WHERE version=?;`, [version]);
        res.download(filePath);
        return;
      }
    }

    throw new Error(`File not found: ${version}/${category}`);
  } catch (err) {
    console.error(err);
    resolver.fail(res, 300);
  }
});

module.exports = router;
