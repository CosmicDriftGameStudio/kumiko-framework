// Storage-provider readStream API.
//
// Invariants:
//   - In-memory provider: readStream yields the bytes as a single chunk,
//     identical to the write+read round trip.
//   - Local provider: readStream uses fs.createReadStream, yielding multiple
//     chunks for files larger than the high-water mark. Failure is lazy: ENOENT
//     occurs on the first chunk pull, not when readStream is called.
//   - Both providers throw for a missing key during consumption, not when
//     readStream() is called—the same lazy pattern as S3.
//
// readStream and writeStream are required in the provider surface, not
// optional. The type compiler enforces their implementation instead of
// allowing a silent runtime throw.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";
import { createLocalProvider } from "../local-provider.ts";

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

describe("FileStorageProvider.readStream — in-memory", () => {
  test("readStream returnt geschriebene Bytes identisch", async () => {
    const provider = createInMemoryFileProvider();
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await provider.write("test/foo.bin", data);

    const result = await collect(provider.readStream("test/foo.bin"));
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
  });

  test("missing-key throw't beim ersten chunk-pull (lazy-Pattern)", async () => {
    const provider = createInMemoryFileProvider();
    // readStream() itself does not throw—the iterator object exists.
    const stream = provider.readStream("does/not/exist.bin");
    expect(stream).toBeDefined();
    // The error occurs only when iterating.
    await expect(collect(stream)).rejects.toThrow(/in-memory file not found/);
  });
});

describe("FileStorageProvider.readStream — local", () => {
  let basePath: string;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "kumiko-readstream-test-"));
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  test("readStream returnt geschriebene Bytes identisch", async () => {
    const provider = createLocalProvider(basePath);
    const data = new Uint8Array([10, 20, 30, 40, 50]);
    await provider.write("foo.bin", data);

    const result = await collect(provider.readStream("foo.bin"));
    expect(Array.from(result)).toEqual([10, 20, 30, 40, 50]);
  });

  test("readStream chunkt grosse Files (>64KB highWaterMark)", async () => {
    // 200KB > default highWaterMark=64KB → erwartet mind. 2 chunks.
    const provider = createLocalProvider(basePath);
    const big = new Uint8Array(200 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
    await provider.write("big.bin", big);

    let chunkCount = 0;
    let totalBytes = 0;
    for await (const chunk of provider.readStream("big.bin")) {
      chunkCount++;
      totalBytes += chunk.byteLength;
    }
    expect(chunkCount).toBeGreaterThan(1);
    expect(totalBytes).toBe(200 * 1024);
  });

  test("ENOENT throw't beim ersten chunk-pull (lazy-Pattern)", async () => {
    // This confirms that readStream() itself performs no filesystem lookup;
    // node:fs createReadStream emits an error event only when reading is
    // attempted. Test coverage matches the in-memory variant.
    const provider = createLocalProvider(basePath);
    const stream = provider.readStream("does/not/exist.bin");
    expect(stream).toBeDefined();
    await expect(collect(stream)).rejects.toThrow(/ENOENT|no such file/);
  });
});
