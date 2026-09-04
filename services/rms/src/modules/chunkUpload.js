const fs = require("fs");
const path = require("path");
const { once } = require("events");
const { pipeline } = require("stream/promises");

const VALID_CATEGORIES = new Set(["win", "mac"]);
const VALID_EXTENSIONS = {
  win: ".exe",
  mac: ".dmg",
};
const SAFE_TOKEN = /^[a-zA-Z0-9._-]+$/;
const SAFE_FILENAME = /^[a-zA-Z0-9._ ()-]+$/;

function validateToken(value, field, maxLength = 128) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !SAFE_TOKEN.test(value)
  ) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function parseChunkMetadata(query) {
  const version = validateToken(query.version, "version");
  const uploadId = validateToken(query.upload_id, "upload_id");
  const filename = query.filename;
  const category = query.category;
  const chunkIndex = Number(query.chunk_index);
  const totalChunks = Number(query.total_chunks);
  const fileSize = Number(query.file_size);

  if (!VALID_CATEGORIES.has(category)) throw new Error("Invalid category");
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    filename.length > 255 ||
    path.basename(filename) !== filename ||
    !SAFE_FILENAME.test(filename)
  ) {
    throw new Error("Invalid filename");
  }
  if (path.extname(filename).toLowerCase() !== VALID_EXTENSIONS[category]) {
    throw new Error("Invalid file extension");
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error("Invalid chunk_index");
  }
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 10000) {
    throw new Error("Invalid total_chunks");
  }
  if (chunkIndex >= totalChunks) throw new Error("chunk_index is out of range");
  if (!Number.isSafeInteger(fileSize) || fileSize < 1) {
    throw new Error("Invalid file_size");
  }

  return {
    version,
    uploadId,
    filename,
    category,
    chunkIndex,
    totalChunks,
    fileSize,
    isBeta: query.beta === "true",
  };
}

function getUploadPath(releaseDirPath, uploadId) {
  return path.join(releaseDirPath, ".uploads", uploadId);
}

function manifestFor(metadata) {
  const { version, filename, category, totalChunks, fileSize, isBeta } = metadata;
  return { version, filename, category, totalChunks, fileSize, isBeta };
}

async function ensureManifest(uploadPath, metadata) {
  const manifestPath = path.join(uploadPath, "manifest.json");
  const expected = JSON.stringify(manifestFor(metadata));

  try {
    await fs.promises.writeFile(manifestPath, expected, { flag: "wx" });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const existing = await fs.promises.readFile(manifestPath, "utf8");
    if (existing !== expected) throw new Error("Upload metadata does not match");
  }
}

async function storeChunk(releaseDirPath, fileStream, metadata) {
  const uploadPath = getUploadPath(releaseDirPath, metadata.uploadId);
  await fs.promises.mkdir(uploadPath, { recursive: true });
  await ensureManifest(uploadPath, metadata);

  const chunkPath = path.join(uploadPath, `${metadata.chunkIndex}.part`);
  const temporaryPath = `${chunkPath}.uploading`;

  try {
    await pipeline(fileStream, fs.createWriteStream(temporaryPath));
    await fs.promises.rename(temporaryPath, chunkPath);
    return (await fs.promises.stat(chunkPath)).size;
  } catch (err) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw err;
  }
}

async function loadManifest(releaseDirPath, uploadId) {
  validateToken(uploadId, "upload_id");
  const manifestPath = path.join(getUploadPath(releaseDirPath, uploadId), "manifest.json");
  return JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
}

async function combineChunks(releaseDirPath, uploadId) {
  const uploadPath = getUploadPath(releaseDirPath, uploadId);
  const metadata = await loadManifest(releaseDirPath, uploadId);
  const flagPath = path.join(
    releaseDirPath,
    metadata.version,
    metadata.isBeta ? "beta" : "alpha"
  );
  const categoryPath = path.join(flagPath, metadata.category);
  const temporaryPath = path.join(flagPath, `.${metadata.filename}.${uploadId}.uploading`);

  await fs.promises.mkdir(categoryPath, { recursive: true });

  const output = fs.createWriteStream(temporaryPath, { flags: "w" });
  let combinedSize = 0;

  try {
    for (let index = 0; index < metadata.totalChunks; index++) {
      const chunkPath = path.join(uploadPath, `${index}.part`);
      await fs.promises.access(chunkPath, fs.constants.R_OK);
      for await (const data of fs.createReadStream(chunkPath)) {
        combinedSize += data.length;
        if (!output.write(data)) await once(output, "drain");
      }
    }
    output.end();
    await once(output, "finish");

    if (combinedSize !== metadata.fileSize) {
      throw new Error(
        `Combined file size mismatch: ${combinedSize}/${metadata.fileSize}`
      );
    }

    for (const filename of await fs.promises.readdir(categoryPath)) {
      await fs.promises.rm(path.join(categoryPath, filename), { force: true });
    }

    const destinationPath = path.join(categoryPath, metadata.filename);
    await fs.promises.rename(temporaryPath, destinationPath);
    await fs.promises.rm(uploadPath, { recursive: true, force: true });

    return { ...metadata, destinationPath };
  } catch (err) {
    output.destroy();
    await fs.promises.rm(temporaryPath, { force: true });
    throw err;
  }
}

async function abortUpload(releaseDirPath, uploadId) {
  validateToken(uploadId, "upload_id");
  await fs.promises.rm(getUploadPath(releaseDirPath, uploadId), {
    recursive: true,
    force: true,
  });
}

module.exports = {
  abortUpload,
  combineChunks,
  parseChunkMetadata,
  storeChunk,
};
