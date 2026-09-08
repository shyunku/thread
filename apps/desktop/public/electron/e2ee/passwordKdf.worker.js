const { parentPort, workerData } = require("node:worker_threads");
const sodium = require("libsodium-wrappers-sumo");
(async () => {
  const password = Buffer.from(workerData.password), salt = Buffer.from(workerData.salt);
  let derived;
  try {
    await sodium.ready;
    derived = Buffer.from(sodium.crypto_pwhash(32, password, salt, 3, 64 * 1024 * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13));
    parentPort.postMessage({ key: derived });
  } catch { parentPort.postMessage({ error: "PASSWORD_KDF_FAILED" }); }
  finally { password.fill(0); derived?.fill(0); workerData.password.fill(0); }
})();
