const axios = require("axios").default.create();

// Detailed diagnostics in normal mode. --secure-logs suppresses output centrally.
function status(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
async function request(method, host, urlPostfix, data, options) {
  console.info("HTTP_REQUEST", { method, host, urlPostfix, data });
  try {
    const url = `${host}${urlPostfix}`;
    const response = method === "POST" ? await axios.post(url, data, options) : await axios.get(url, options);
    console.info("HTTP_RESPONSE", { method, status: status(response.status), data: response.data });
    return response.data;
  } catch (error) {
    console.error("HTTP_REQUEST_FAILED", { method, status: status(error?.response?.status) }, error);
    throw error;
  }
}
module.exports = {
  ok: 200,
  post: (host, urlPostfix, data, options) => request("POST", host, urlPostfix, data, options),
  get: (host, urlPostfix, options) => request("GET", host, urlPostfix, undefined, options),
};
