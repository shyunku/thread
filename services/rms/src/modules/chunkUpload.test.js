const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const chunkUpload = require("./chunkUpload");

async function run() {
  const releaseDirPath = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "thread-rms-chunks-")
  );
  const content = Buffer.from("thread-chunk-upload-test");
  const chunks = [
    content.subarray(0, 7),
    content.subarray(7, 15),
    content.subarray(15),
  ];
  const baseQuery = {
    upload_id: "test-upload-id",
    version: "1.0.3",
    category: "win",
    beta: "false",
    filename: "Thread Setup 1.0.3.exe",
    file_size: String(content.length),
    total_chunks: String(chunks.length),
  };

  try {
    for (const chunkIndex of [2, 0, 1]) {
      const metadata = chunkUpload.parseChunkMetadata({
        ...baseQuery,
        chunk_index: String(chunkIndex),
      });
      await chunkUpload.storeChunk(
        releaseDirPath,
        Readable.from(chunks[chunkIndex]),
        metadata
      );
    }

    const result = await chunkUpload.combineChunks(
      releaseDirPath,
      baseQuery.upload_id
    );
    assert.strictEqual(result.version, baseQuery.version);
    assert.strictEqual(result.category, baseQuery.category);
    assert.deepStrictEqual(
      await fs.promises.readFile(result.destinationPath),
      content
    );

    assert.throws(
      () =>
        chunkUpload.parseChunkMetadata({
          ...baseQuery,
          filename: "../unsafe.exe",
          chunk_index: "0",
        }),
      /Invalid filename/
    );

    const partialMetadata = chunkUpload.parseChunkMetadata({
      ...baseQuery,
      upload_id: "partial-upload",
      chunk_index: "0",
    });
    await chunkUpload.storeChunk(
      releaseDirPath,
      Readable.from(chunks[0]),
      partialMetadata
    );
    await assert.rejects(
      chunkUpload.combineChunks(releaseDirPath, partialMetadata.uploadId),
      /ENOENT/
    );
    await chunkUpload.abortUpload(releaseDirPath, partialMetadata.uploadId);
    assert.strictEqual(
      fs.existsSync(
        path.join(releaseDirPath, ".uploads", partialMetadata.uploadId)
      ),
      false
    );

    console.log("chunk upload tests passed");
  } finally {
    await fs.promises.rm(releaseDirPath, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
