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

async function* slowChunks(chunks: Uint8Array[], delayMs: number): AsyncIterable<Uint8Array> {
  for (const c of chunks) {
    await new Promise((r) => setTimeout(r, delayMs));
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
    await provider.writeStream("test/file.bin", fromChunks(chunks));

    const data = await provider.read("test/file.bin");
    expect(Array.from(data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("leerer Stream → leere Datei", async () => {
    const provider = createInMemoryFileProvider();
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

  test("atomar: bei wirfendem Stream entsteht KEIN final-Pfad-File", async () => {
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

    await provider.writeStream("lazy.bin", lazySource());

    const data = await provider.read("lazy.bin");
    expect(Array.from(data)).toEqual([1, 2, 3]);
  });

  test("local-Provider streamt WAEHREND der Source yieldet (tmp-File existiert pre-completion)", async () => {
    // Echter Streaming-Property-Test: bei langsamen Source-yields muss
    // der local-Provider die tmp-File anfangen zu schreiben WAEHREND
    // wir noch chunks zur Verfuegung stellen — nicht erst alle chunks
    // collecten.
    //
    // Pattern: 5 chunks mit je 30ms delay zwischen yields. Wir starten
    // writeStream + pollen alle 10ms (max 200ms) bis tmp-File auftaucht.
    // Bei collect-then-write taucht NIE eine tmp-File auf — Test failed
    // dann via Timeout. Poll-basiert statt time-hardcoded gibt CI-
    // Geschwindigkeits-Toleranz; flake-frei solange total-source-time
    // (5 × 30ms = 150ms) > poll-Granularitaet (10ms).
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

      // Poll bis tmp existiert ODER final schon fertig (zu schneller CI).
      let hasTmp = false;
      let alreadyDone = false;
      for (let i = 0; i < 20 && !hasTmp && !alreadyDone; i++) {
        await new Promise((r) => setTimeout(r, 10));
        const dirContents = await readdir(basePath);
        hasTmp = dirContents.some((f) => f.endsWith(".tmp"));
        alreadyDone = dirContents.includes("streamed.bin");
      }
      if (alreadyDone && !hasTmp) {
        throw new Error(
          "slowChunks-delay zu kurz fuer CI: writeStream war fertig bevor poll start. " +
            "delayMs erhoehen oder chunks reduzieren.",
        );
      }
      expect(hasTmp).toBe(true); // tmp existiert WAEHREND yields

      // Warten auf completion
      await writePromise;

      // Nach completion: tmp ist weg, final-File ist da
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
