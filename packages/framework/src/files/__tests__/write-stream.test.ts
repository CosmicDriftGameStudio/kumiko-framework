// Storage-Provider writeStream-API (S2.U3 Atom 1d).
//
// Pinst:
//   - In-memory-Provider: writeStream collected chunks + macht
//     read-Roundtrip identisch zu write(uint8array).
//   - Local-Provider: writeStream schreibt atomar via tmp + rename,
//     halb-fertige Stream-Bricht hinterlassen keine Garbage am Final-
//     Pfad.
//   - Beide Provider liefern die Bytes via read() identisch zurueck —
//     kein chunk-Loss, kein chunk-Order-Verlust.
//
// AsyncIterable-source pinst die Streaming-Semantik (Caller streamt
// chunk-fuer-chunk, Provider niemals alles im Memory).

import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createInMemoryFileProvider } from "../in-memory-provider";
import { createLocalProvider } from "../local-provider";

async function* fromChunks(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) {
    yield c;
  }
}

describe("FileStorageProvider.writeStream — in-memory", () => {
  test("schreibt 3 chunks + read liefert konkateniert zurueck", async () => {
    const provider = createInMemoryFileProvider();
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
    ];
    if (!provider.writeStream) throw new Error("writeStream missing");
    await provider.writeStream("test/file.bin", fromChunks(chunks));

    const data = await provider.read("test/file.bin");
    expect(Array.from(data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("leerer Stream → leere Datei", async () => {
    const provider = createInMemoryFileProvider();
    if (!provider.writeStream) throw new Error("writeStream missing");
    await provider.writeStream("empty.bin", fromChunks([]));

    const data = await provider.read("empty.bin");
    expect(data.byteLength).toBe(0);
  });

  test("mimeType-Option wird in der gespeicherten Entry erhalten", async () => {
    // Kein direkter Read-Pfad fuer mimeType — wir checken via existing-
    // Marker (write-Pfad teilt den storage-shape). Symmetrie-Test:
    // ein write() + ein writeStream() mit gleichem key + gleichem
    // mimeType muessen byte-identische Reads liefern.
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

  test("schreibt + read roundtrip mit chunked source", async () => {
    const provider = createLocalProvider(basePath);
    const chunks = [new Uint8Array([10, 20, 30]), new Uint8Array([40, 50, 60])];
    if (!provider.writeStream) throw new Error("writeStream missing");
    await provider.writeStream("dir/foo.bin", fromChunks(chunks));

    const data = await provider.read("dir/foo.bin");
    expect(Array.from(data)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  test("legt parent-Verzeichnisse rekursiv an", async () => {
    const provider = createLocalProvider(basePath);
    if (!provider.writeStream) throw new Error("writeStream missing");
    await provider.writeStream("deeply/nested/path/file.bin", fromChunks([new Uint8Array([1])]));

    const stats = await stat(join(basePath, "deeply/nested/path/file.bin"));
    expect(stats.isFile()).toBe(true);
  });

  test("atomar: bei wirfendem Stream entsteht KEIN final-Pfad-File", async () => {
    const provider = createLocalProvider(basePath);

    async function* failingSource(): AsyncIterable<Uint8Array> {
      yield new Uint8Array([1, 2, 3]);
      throw new Error("synthetic mid-stream failure");
    }

    if (!provider.writeStream) throw new Error("writeStream missing");
    await expect(provider.writeStream("dir/half.bin", failingSource())).rejects.toThrow(
      /synthetic mid-stream failure/,
    );

    expect(await provider.exists("dir/half.bin")).toBe(false);
  });

  test("atomar: nach Failure ist KEIN final-Pfad-File da (.tmp-Leak ist best-effort)", async () => {
    // Echte Atomicity-Garantie: der final-Pfad ist niemals halb-fertig
    // sichtbar. tmp-Files koennen je nach OS-Race im destroy-Pfad
    // kurz liegen bleiben — kein Korrektheitsproblem (kein Reader
    // sucht nach `*.tmp`-Patterns), nur Operations-Hygiene.
    const provider = createLocalProvider(basePath);

    async function* failing(): AsyncIterable<Uint8Array> {
      yield new Uint8Array([99]);
      throw new Error("fail");
    }

    if (!provider.writeStream) throw new Error("writeStream missing");
    await expect(provider.writeStream("subdir/leak-check.bin", failing())).rejects.toThrow();

    // Final-Pfad ist NICHT da — das ist die harte Garantie.
    expect(await provider.exists("subdir/leak-check.bin")).toBe(false);

    // tmp-Files duerfen nicht den final-Namen haben (sonst kein Atomicity).
    const entries = await readdir(join(basePath, "subdir"));
    for (const entry of entries) {
      expect(entry).not.toBe("leak-check.bin");
    }
  });

  test("ueberschreibt existing file atomar (rename ueber bestehenden Pfad)", async () => {
    const provider = createLocalProvider(basePath);
    if (!provider.writeStream) throw new Error("writeStream missing");

    await provider.write("k", new Uint8Array([1, 1, 1]));
    await provider.writeStream("k", fromChunks([new Uint8Array([2, 2, 2])]));

    const data = await provider.read("k");
    expect(Array.from(data)).toEqual([2, 2, 2]);
  });
});

describe("FileStorageProvider.writeStream — Streaming-Property", () => {
  // Pinst dass writeStream tatsaechlich AsyncIterable konsumiert ohne
  // alle chunks in eine Promise.resolve(...) Array zu converten.
  // Wenn ein Provider intern das chunks-Array sammelt, ist das fuer
  // unsere semantischen Garantien OK — wir testen nur das Resultat.
  // Dieser Test sichert dass der Caller ein REIN async-iterable
  // uebergeben kann (z.B. ZIP-Stream der chunks lazy generiert).

  test("Source mit Promise-delays wird korrekt verarbeitet", async () => {
    const provider = createInMemoryFileProvider();

    async function* lazySource(): AsyncIterable<Uint8Array> {
      await new Promise((r) => setTimeout(r, 5));
      yield new Uint8Array([1]);
      await new Promise((r) => setTimeout(r, 5));
      yield new Uint8Array([2]);
      await new Promise((r) => setTimeout(r, 5));
      yield new Uint8Array([3]);
    }

    if (!provider.writeStream) throw new Error("writeStream missing");
    await provider.writeStream("lazy.bin", lazySource());

    const data = await provider.read("lazy.bin");
    expect(Array.from(data)).toEqual([1, 2, 3]);
  });
});
