const fs = require("fs-extra");
const path = require("path");
const { pipeline } = require("stream/promises");
const progressStream = require("progress-stream");

async function downloadRelease({
  axios,
  serverHost,
  userDataPath,
  category,
  version,
  onProgress = () => {},
}) {
  if (
    !["win", "mac"].includes(category) ||
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
  ) {
    throw Error("INVALID_RELEASE");
  }
  const directory = path.join(userDataPath, "releases", version);
  await fs.ensureDir(directory);
  const target = path.join(
    directory,
    version + (category === "win" ? ".exe" : ".dmg")
  );
  const partial = target + ".partial";
  let response;
  try {
    response = await axios.get(serverHost + "/default/release", {
      params: { version, category },
      responseType: "stream",
      timeout: 30000,
    });
    if (/json|text\//i.test(response.headers["content-type"] || ""))
      throw Error("INVALID_RELEASE_RESPONSE");
    const progress = progressStream({
      time: 100,
      length: response.headers["content-length"],
    });
    progress.on("progress", onProgress);
    await pipeline(response.data, progress, fs.createWriteStream(partial));
    if (!(await fs.stat(partial)).size) throw Error("EMPTY_RELEASE");
    if (category === "win") {
      const file = await fs.open(partial, "r");
      try {
        const signature = Buffer.alloc(2);
        await fs.read(file, signature, 0, 2, 0);
        if (signature.toString() !== "MZ") throw Error("INVALID_INSTALLER");
      } finally {
        await fs.close(file);
      }
    }
    await fs.move(partial, target, { overwrite: true });
    return target;
  } catch (error) {
    response?.data?.destroy();
    await fs.remove(partial);
    throw error;
  }
}
module.exports = { downloadRelease };
