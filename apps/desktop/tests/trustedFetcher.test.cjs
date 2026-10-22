const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { IdleTimeoutFetcher } = require("../public/electron/e2ee/trustedUpdates");
const { DownloadHTTPError } = require("tuf-js/dist/error");

// A local server whose routes stream slowly, stall, never answer or 404.
async function server(t) {
  const srv = http.createServer((req, res) => {
    if (req.url === "/slow") {
      // 20 chunks 50ms apart: about 1s in total, never quiet for long.
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      let n = 0;
      const tick = setInterval(() => { res.write(Buffer.alloc(1000, n)); if (++n === 20) { clearInterval(tick); res.end(); } }, 50);
      req.on("close", () => clearInterval(tick));
    } else if (req.url === "/stall") {
      res.writeHead(200); res.write(Buffer.alloc(1000)); // then silence
    } else if (req.url === "/silent") {
      // no response at all
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  return `http://127.0.0.1:${srv.address().port}`;
}

test("a download that is slow overall but never quiet completes", async (t) => {
  const base = await server(t);
  const fetcher = new IdleTimeoutFetcher({ connectTimeout: 400, idleTimeout: 400 });
  const bytes = await fetcher.downloadBytes(base + "/slow", 1e6);
  assert.equal(bytes.length, 20000);
});

test("a body that stops arriving is aborted after the idle timeout", async (t) => {
  const base = await server(t);
  const fetcher = new IdleTimeoutFetcher({ connectTimeout: 100, idleTimeout: 150 });
  const started = Date.now();
  await assert.rejects(fetcher.downloadBytes(base + "/stall", 1e6), /UPDATE_DOWNLOAD_STALLED|aborted/);
  assert.ok(Date.now() - started < 2000);
});

test("no response within the connect timeout is aborted", async (t) => {
  const base = await server(t);
  const fetcher = new IdleTimeoutFetcher({ connectTimeout: 100, idleTimeout: 5000 });
  await assert.rejects(fetcher.downloadBytes(base + "/silent", 1e6), /UPDATE_DOWNLOAD_STALLED|aborted/);
});

test("HTTP errors keep the tuf-js error type so a missing next root is still recognised", async (t) => {
  const base = await server(t);
  const fetcher = new IdleTimeoutFetcher({ connectTimeout: 1000, idleTimeout: 1000 });
  await assert.rejects(fetcher.downloadBytes(base + "/2.root.json", 1e6), (error) => error instanceof DownloadHTTPError && error.statusCode === 404);
});
