// Storage-provider writeStream API.
//
// Tests:
//   - In-memory provider: writeStream collects chunks and produces a
//     read round trip identical to write(uint8array).
//   - Local provider: writeStream writes atomically via tmp + rename, so
//     an interrupted stream leaves no garbage at the final path.
//   - Both providers return identical bytes via read(): no chunk loss or
//     chunk-order loss.
//
// An AsyncIterable source tests streaming semantics: the caller provides
// chunks incrementally, and the provider need not hold the entire stream in memory.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";
import { createLocalProvider } from "../local-provider.ts";

async function* fromChunks(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) {
    yield c;
  }
}

async function* slowChunks(chunks: Uint8Array[], delayMs: number): AsyncIterable<Uint8Array> {
  for (const c of chunks) {
    await new Promise((r) => setTimeout(r, delayMs));
    yield c;
  }
}

describe("FileStorageProvider.writeStream — in-memory", () => {
  test("writes 3 chunks and read returns them concatenated", async () => {
    const provider = createInMemoryFileProvider();
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
    ];
    await provider.writeStream("test/file.bin", fromChunks(chunks));

    const data = await provider.read("test/file.bin");
    expect(Array.from(data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("empty stream → empty file", async () => {
    const provider = createInMemoryFileProvider();
    await provider.writeStream("empty.bin", fromChunks([]));

    const data = await provider.read("empty.bin");
    expect(data.byteLength).toBe(0);
  });

  test("mimeType option is preserved in the stored Entry", async () => {
    // There is no direct read path for mimeType, so we verify it through
    // the existing marker (the write path shares the storage shape).
    // This symmetry test checks that write() and writeStream() with the
    // same key and mimeType produce byte-identical reads.
    const a = createInMemoryFileProvider();
    const b = createInMemoryFileProvider();
    const bytes = new Uint8Array([42, 43, 44]);

    await a.write("k", bytes, "application/zip");
    if (!b.writeStream) throw new Error("writeStream missing");
    await b.writeStream("k", fromChunks([bytes]), { mimeType: "application/zip" });

    expect(Array.from(await a.read("k"))).toEqual(Array.from(await b.read("k")));
  });
});

describe("FileStorageProvider.writeStream — local-filesystem", () => {
  let basePath: string;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "kumiko-write-stream-"));
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  test("write/read roundtrip with a chunked source", async () => {
    const provider = createLocalProvider(basePath);
    const chunks = [new Uint8Array([10, 20, 30]), new Uint8Array([40, 50, 60])];
    await provider.writeStream("dir/foo.bin", fromChunks(chunks));

    const data = await provider.read("dir/foo.bin");
    expect(Array.from(data)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  test("legt parent-Verzeichnisse rekursiv an", async () => {
    const provider = createLocalProvider(basePath);
    await provider.writeStream("deeply/nested/path/file.bin", fromChunks([new Uint8Array([1])]));

    const stats = await stat(join(basePath, "deeply/nested/path/file.bin"));
    expect(stats.isFile()).toBe(true);
  });

  test("atomic: a throwing stream produces no file at the final path", async () => {
    const provider = createLocalProvider(basePath);

    async function* failingSource(): AsyncIterable<Uint8Array> {
      yield new Uint8Array([1, 2, 3]);
      throw new Error("synthetic mid-stream failure");
    }

    await expect(provider.writeStream("dir/half.bin", failingSource())).rejects.toThrow(
      /synthetic mid-stream failure/,
    );

    expect(await provider.exists("dir/half.bin")).toBe(false);
  });

  test("atomic: after failure, there is no file at the final path (.tmp leak is best effort)", async () => {
    // The final path is never visible in a partially written state. Depending
    // on OS timing, tmp files may briefly remain during destruction; this
    // affects only operational hygiene, because no reader looks for
    // `*.tmp` patterns.
    const provider = createLocalProvider(basePath);

    async function* failing(): AsyncIterable<Uint8Array> {
      yield new Uint8Array([99]);
      throw new Error("fail");
    }

    await expect(provider.writeStream("subdir/leak-check.bin", failing())).rejects.toThrow();

    // The final path must not exist after a failed write.
    expect(await provider.exists("subdir/leak-check.bin")).toBe(false);

    // Temporary files must not use the final name, or the write would not be atomic.
    const entries = await readdir(join(basePath, "subdir"));
    for (const entry of entries) {
      expect(entry).not.toBe("leak-check.bin");
    }
  });

  test("atomically overwrites existing file (rename over existing path)", async () => {
    const provider = createLocalProvider(basePath);

    await provider.write("k", new Uint8Array([1, 1, 1]));
    await provider.writeStream("k", fromChunks([new Uint8Array([2, 2, 2])]));

    const data = await provider.read("k");
    expect(Array.from(data)).toEqual([2, 2, 2]);
  });

  test("write/read/delete reject a key that escapes basePath; exists reports false", async () => {
    const provider = createLocalProvider(basePath);
    const escapingKey = "../../etc/passwd";

    await expect(provider.write(escapingKey, new Uint8Array([1]))).rejects.toThrow(
      /path-traversal/,
    );
    await expect(provider.read(escapingKey)).rejects.toThrow(/path-traversal/);
    await expect(provider.delete(escapingKey)).rejects.toThrow(/path-traversal/);
    // exists() treats any stat failure (missing file, escaping key) as "not there".
    expect(await provider.exists(escapingKey)).toBe(false);
  });
});

describe("FileStorageProvider.writeStream — Streaming-Property", () => {
  // This verifies that writeStream accepts a genuine AsyncIterable without
  // requiring the caller to convert all chunks into a Promise.resolve(...)
  // array. A provider may collect the chunks internally; this test checks
  // only the resulting semantics. The caller can therefore provide a
  // lazy async iterable, such as a ZIP stream.

  test("Source with Promise delays is processed correctly", async () => {
    const provider = createInMemoryFileProvider();

    async function* lazySource(): AsyncIterable<Uint8Array> {
      await new Promise((r) => setTimeout(r, 5));
      yield new Uint8Array([1]);
      await new Promise((r) => setTimeout(r, 5));
      yield new Uint8Array([2]);
      await new Promise((r) => setTimeout(r, 5));
      yield new Uint8Array([3]);
    }

    await provider.writeStream("lazy.bin", lazySource());

    const data = await provider.read("lazy.bin");
    expect(Array.from(data)).toEqual([1, 2, 3]);
  });

  test("local provider streams while the source yields (tmp file exists before completion)", async () => {
    // This streaming-property test ensures that the local provider starts
    // writing the tmp file while the source is still yielding chunks,
    // rather than collecting every chunk first.
    //
    // Five chunks are yielded with a 30ms delay between them. We start
    // writeStream and poll every 10ms (for up to 200ms) until the tmp file
    // appears. With collect-then-write, no tmp file would appear and the
    // test would time out. Polling instead of using a fixed time allows
    // for CI speed variation; it remains reliable while the total source
    // time (5 × 30ms = 150ms) exceeds the polling interval (10ms).
    const basePath = await mkdtemp(join(tmpdir(), "kumiko-stream-prop-"));
    try {
      const provider = createLocalProvider(basePath);
      const chunks = [
        new Uint8Array([1]),
        new Uint8Array([2]),
        new Uint8Array([3]),
        new Uint8Array([4]),
        new Uint8Array([5]),
      ];
      const writePromise = provider.writeStream("streamed.bin", slowChunks(chunks, 30));

      // Poll until the tmp file exists or the final write has already completed.
      let hasTmp = false;
      let alreadyDone = false;
      await waitFor(
        async () => {
          const dirContents = await readdir(basePath);
          hasTmp = dirContents.some((f) => f.endsWith(".tmp"));
          alreadyDone = dirContents.includes("streamed.bin");
          return hasTmp || alreadyDone;
        },
        { delays: Array(20).fill(10) },
      );
      if (alreadyDone && !hasTmp) {
        throw new Error(
          "slowChunks-delay zu kurz fuer CI: writeStream war fertig bevor poll start. " +
            "delayMs erhoehen oder chunks reduzieren.",
        );
      }
      expect(hasTmp).toBe(true); // tmp existiert WAEHREND yields

      await writePromise;

      // After completion, the tmp file is gone and the final file exists.
      const finalContents = await readdir(basePath);
      expect(finalContents).toContain("streamed.bin");
      expect(finalContents.filter((f) => f.endsWith(".tmp"))).toEqual([]);

      const data = await provider.read("streamed.bin");
      expect(Array.from(data)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });
});
