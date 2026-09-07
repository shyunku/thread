const fs = require("fs");
const path = require("path");
const resolver = require("../utils/expressResolver");

const validVersion = (value) =>
  typeof value === "string" &&
  value.length <= 100 &&
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
const enabled = (value) => value === true || value === 1 || value === "1";

function hasRelease(root, row, category) {
  if (!validVersion(row.version) || !enabled(row[category])) return false;
  const directory = path.join(
    root,
    row.version,
    enabled(row.beta) ? "beta" : "alpha",
    category
  );
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .some(
        (file) =>
          file.isFile() &&
          file.name.toLowerCase().endsWith(category === "win" ? ".exe" : ".dmg")
      );
  } catch {
    return false;
  }
}

function createReleaseAlerts({ db, axios, releaseRoot, apiEntry }) {
  return {
    publish: async (req, res) => {
      const version = req.body?.version;
      if (!validVersion(version))
        return resolver.fail(res, 400, null, "유효한 버전이 필요합니다.");
      const authorization = req.get("Authorization");
      if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
        return resolver.fail(res, 401, null, "관리자 로그인이 필요합니다.");
      }
      try {
        const auth = await axios.get(apiEntry() + "/v1/admin/session", {
          headers: { Authorization: authorization },
          timeout: 10000,
        });
        if (auth.data?.authorized !== true)
          return resolver.fail(res, 403, null, "관리자 인증에 실패했습니다.");
        const [row] = await db.query(
          "SELECT * FROM version_master WHERE version=?",
          [version]
        );
        if (!row || !enabled(row.verified))
          return resolver.fail(
            res,
            400,
            null,
            "검증된 릴리스만 알릴 수 있습니다."
          );
        if (
          !["win", "mac"].some((category) =>
            hasRelease(releaseRoot(), row, category)
          )
        ) {
          return resolver.fail(
            res,
            400,
            null,
            "다운로드 가능한 릴리스 파일이 없습니다."
          );
        }
        // Persist before acknowledging. Polling clients also catch up after reconnect.
        await db.query(
          "UPDATE version_master SET alerted=true WHERE version=? AND verified=true",
          [version]
        );
        try {
          const result = await axios.post(
            apiEntry() + "/v1/admin/alert-new-version",
            { version },
            { headers: { Authorization: authorization }, timeout: 10000 }
          );
          if (result.data?.published !== true)
            throw Error("BROADCAST_NOT_ACKNOWLEDGED");
          return resolver.ok(res, {
            version,
            published: true,
            delivery: "socket+poll",
            sockets: result.data.sockets,
          });
        } catch {
          // Durable publication remains available for reconnect/poll even if push fails.
          return resolver.ok(res, {
            version,
            published: true,
            delivery: "poll",
            warning: "실시간 전송은 실패했습니다. 주기 확인으로 전달됩니다.",
          });
        }
      } catch (err) {
        const status = err.response?.status;
        const authFailure = status === 401 || status === 403;
        return resolver.fail(
          res,
          authFailure ? status : 300,
          null,
          authFailure
            ? "관리자 인증이 만료되었거나 권한이 없습니다."
            : "알림 발행에 실패했습니다. 연결 상태를 확인해주세요."
        );
      }
    },
    latest: async (req, res) => {
      res.set("Cache-Control", "no-store");
      const category = req.query.category;
      if (!["win", "mac"].includes(category))
        return resolver.fail(res, 400, null, "지원하지 않는 플랫폼입니다.");
      try {
        const betaClause =
          req.query.include_beta === "true" ? "" : " AND beta=false";
        const rows = await db.query(
          `SELECT * FROM version_master WHERE verified=true AND (alerted=true OR not_compatible=true) AND ${category}=true${betaClause} ORDER BY updated_timestamp DESC`
        );
        const releases = rows.filter((item) =>
          hasRelease(releaseRoot(), item, category)
        );
        return resolver.ok(
          res,
          releases.map((row) => ({
            version: row.version,
            beta: enabled(row.beta),
            mandatory: enabled(row.not_compatible),
          }))
        );
      } catch {
        return resolver.fail(res, 300, null, "알림을 확인하지 못했습니다.");
      }
    },
  };
}

module.exports = { createReleaseAlerts, hasRelease, validVersion };
