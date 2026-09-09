const axios = require("axios").default.create();

// Log only allowlisted operational metadata. URLs, query strings, request and
// response bodies, native error messages and headers may contain private data.
function status(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
async function request(method, host, urlPostfix, data, options) {
  console.info("HTTP_REQUEST", { method });
  try {
    const url = `${host}${urlPostfix}`;
    const response = method === "POST" ? await axios.post(url, data, options) : await axios.get(url, options);
    console.info("HTTP_RESPONSE", { method, status: status(response.status) });
    return response.data;
  } catch (error) {
    console.error("HTTP_REQUEST_FAILED", { method, status: status(error?.response?.status) });
    throw error;
  }
}
module.exports = {
  ok: 200,
  post: (host, urlPostfix, data, options) => request("POST", host, urlPostfix, data, options),
  get: (host, urlPostfix, options) => request("GET", host, urlPostfix, undefined, options),
};
