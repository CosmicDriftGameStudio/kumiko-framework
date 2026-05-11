// Storage-Provider readStream-API (S2.U3 Atom 3c.fix).
//
// Pinst:
//   - In-memory-Provider: readStream yieldet die Bytes als single-chunk,
//     Roundtrip identisch zu write+read.
//   - Local-Provider: readStream nutzt fs.createReadStream → mehrere
//     chunks fuer >hwm-Files. Lazy-Fail: ENOENT trifft erst beim ersten
//     chunk-pull, nicht beim readStream-Aufruf.
//   - Beide Provider: missing-key throw't beim Konsum, nicht bei
//     readStream() — gleiches Lazy-Pattern wie S3.
//
// readStream + writeStream sind ab Atom 3c.fix REQUIRED in der Provider-
// Surface (kein optional). Der Type-Compiler erzwingt Implementierung,
// kein silent runtime-throw mehr.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createInMemoryFileProvider } from "../in-memory-provider";
import { createLocalProvider } from "../local-provider";

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
    // readStream() selbst wirft NICHT — das Iterator-Object existiert.
    const stream = provider.readStream("does/not/exist.bin");
    expect(stream).toBeDefined();
    // Erst beim Iterieren faellt der Fehler.
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
    // Pinst dass readStream() selbst kein Filesystem-Lookup macht;
    // node:fs createReadStream emittiert error event erst beim Read-
    // Versuch. Test-Coverage matched die Inmemory-Variante.
    const provider = createLocalProvider(basePath);
    const stream = provider.readStream("does/not/exist.bin");
    expect(stream).toBeDefined();
    await expect(collect(stream)).rejects.toThrow(/ENOENT|no such file/);
  });
});
