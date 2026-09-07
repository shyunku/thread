const resolver = require("../utils/expressResolver");

function createAdminAccess({ axios, apiEntry }) {
  return async (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    try {
      const authorization = req.get("Authorization");
      if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return resolver.fail(res, 401);
      const response = await axios.get(apiEntry() + "/v1/admin/session", {
        headers: { Authorization: authorization }, timeout: 10000,
      });
      if (response.data?.authorized !== true) return resolver.fail(res, 403);
      const policy = req.body?.not_compatible;
      if (policy !== undefined && typeof policy !== "boolean") return resolver.fail(res, 400);
      if (policy === true && (req.body.beta !== false || req.body.verified !== true)) {
        return resolver.fail(res, 400, null, "필수 업데이트는 검증된 일반 릴리스에서만 허용합니다.");
      }
      req.adminAuthorized = true;
      next();
    } catch (error) {
      resolver.fail(res, [401, 403].includes(error.response?.status) ? error.response.status : 300);
    }
  };
}
module.exports = { createAdminAccess };
