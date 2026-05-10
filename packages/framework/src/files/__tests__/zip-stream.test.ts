// Streaming-ZIP-Builder Tests (S2.U3 Atom 3a).
//
// Drei-Schichten-Test:
//   1. Strukturelle Asserts: ZIP-Magic-Numbers an den richtigen Stellen,
//      EOCD am Ende, central-dir-Count matcht emittierte Entries.
//   2. CRC32-Korrektheit gegen Reference-Implementation (crypto.subtle
//      oder bekannte Test-Vektoren).
//   3. Real-Roundtrip via `unzip` shell-binary: ZIP in tmp-File schreiben,
//      `unzip -l` + `unzip -p` aufrufen, Inhalt verifizieren. Pinst
//      dass das ZIP von einem realen Decoder (Info-ZIP) gelesen werden
//      kann — kein "passt nur in unserer eigenen reverse-engineerten
//      Welt".

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getTemporal } from "../../time";
import { createZipStream, type ZipEntry } from "../zip-stream";

async function* fromString(s: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(s);
}

async function* fromBytes(b: Uint8Array): AsyncIterable<Uint8Array> {
  yield b;
}

async function* fromEntries(entries: ZipEntry[]): AsyncIterable<ZipEntry> {
  for (const e of entries) yield e;
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset + offset, 4).getUint32(0, true);
}

function readU16LE(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset + offset, 2).getUint16(0, true);
}

describe("createZipStream :: structural asserts", () => {
  test("leerer Stream → nur EOCD-Record (22 Bytes)", async () => {
    const zip = await collect(createZipStream(fromEntries([])));
    expect(zip.byteLength).toBe(22);
    // EOCD-Magic 0x06054b50 ("PK\x05\x06")
    expect(readU32LE(zip, 0)).toBe(0x06054b50);
    // 0 entries
    expect(readU16LE(zip, 8)).toBe(0);
    expect(readU16LE(zip, 10)).toBe(0);
  });

  test("1 Entry → Local-File-Header + body + central-dir + EOCD", async () => {
    const body = "hello";
    const zip = await collect(
      createZipStream(fromEntries([{ path: "greet.txt", data: fromString(body) }])),
    );

    // Local file header signature 0x04034b50 ("PK\x03\x04") am Anfang
    expect(readU32LE(zip, 0)).toBe(0x04034b50);
    // method = STORE = 0
    expect(readU16LE(zip, 8)).toBe(0);
    // filename length = 9 ("greet.txt")
    expect(readU16LE(zip, 26)).toBe(9);
    // body folgt nach 30+9=39 bytes
    const bodyStart = 39;
    const bodyBytes = zip.slice(bodyStart, bodyStart + 5);
    expect(new TextDecoder().decode(bodyBytes)).toBe(body);

    // EOCD am Ende
    const eocdStart = zip.byteLength - 22;
    expect(readU32LE(zip, eocdStart)).toBe(0x06054b50);
    expect(readU16LE(zip, eocdStart + 8)).toBe(1); // 1 entry
  });

  test("3 Entries → 3 LFH + 3 central-dir-records + 1 EOCD", async () => {
    const zip = await collect(
      createZipStream(
        fromEntries([
          { path: "a.txt", data: fromString("aaa") },
          { path: "b.txt", data: fromString("bbb") },
          { path: "c.txt", data: fromString("ccc") },
        ]),
      ),
    );

    // EOCD reports 3 entries
    const eocdStart = zip.byteLength - 22;
    expect(readU32LE(zip, eocdStart)).toBe(0x06054b50);
    expect(readU16LE(zip, eocdStart + 8)).toBe(3);
    expect(readU16LE(zip, eocdStart + 10)).toBe(3);
  });
});

describe("createZipStream :: CRC32 correctness", () => {
  test("CRC32 von 'hello' matcht IEEE-802.3-Reference (0x3610a686)", async () => {
    const zip = await collect(
      createZipStream(fromEntries([{ path: "x.txt", data: fromString("hello") }])),
    );
    // CRC32 ist im LFH bei Offset 14
    const crc = readU32LE(zip, 14);
    // Reference: crc32("hello") = 0x3610a686 (verifiziert via
    // python3 -c 'import zlib; print(hex(zlib.crc32(b"hello")))')
    expect(crc).toBe(0x3610a686);
  });

  test("CRC32 von '123456789' matcht Industrie-Standard-Reference (0xCBF43926)", async () => {
    // "123456789" → 0xCBF43926 ist DER IEEE-802.3 CRC32 Test-Vektor;
    // RFC 1952 (gzip) und RFC 3309 nutzen ihn als Reference. Wenn unsere
    // Implementation hier fehlt, ist die ganze CRC32-Algorithm broken.
    const zip = await collect(
      createZipStream(fromEntries([{ path: "x.txt", data: fromString("123456789") }])),
    );
    expect(readU32LE(zip, 14)).toBe(0xcbf43926);
  });

  test("CRC32 von leerem Body = 0", async () => {
    const zip = await collect(
      createZipStream(fromEntries([{ path: "empty.txt", data: fromBytes(new Uint8Array(0)) }])),
    );
    expect(readU32LE(zip, 14)).toBe(0);
  });
});

describe("createZipStream :: UTF-8 filename support", () => {
  test("General-Purpose-Flag Bit 11 (0x0800) ist gesetzt", async () => {
    const zip = await collect(
      createZipStream(fromEntries([{ path: "ascii.txt", data: fromString("x") }])),
    );
    // General Purpose Flags sind im LFH bei Offset 6
    const flags = readU16LE(zip, 6);
    expect(flags & 0x0800).toBe(0x0800);
  });
});

describe("createZipStream :: format limits (ZIP64-Pre-Check)", () => {
  // Entry >4 GB Pre-Check ist im Code aktiv (siehe createZipStream Source);
  // ein echter 4-GB-Body ist im Test nicht allozierbar. Der 65535-Entry-Test
  // unten deckt die parallele Constraint-Variante ab — Refactor-Schutz.

  test("Archive >65535 Entries wirft mit klarer Begruendung", async () => {
    // 65535 Entries sind langsam (jedes hat einen Header). 65536 reicht
    // um den Branch zu triggern. Body kann leer sein — wir testen das
    // entry-count-cap, nicht den body-cap.
    async function* manyEntries(): AsyncIterable<ZipEntry> {
      for (let i = 0; i < 65536; i++) {
        yield { path: `e${i}.txt`, data: fromBytes(new Uint8Array(0)) };
      }
    }
    await expect(collect(createZipStream(manyEntries()))).rejects.toThrow(
      /exceeds 65535-entry limit/,
    );
  }, 30_000); // 30s timeout — 65536 entries iterieren
});

// **Plattform-Abhaengigkeit:** dieser describe braucht das `unzip`-
// shell-binary (Info-ZIP). macOS + Linux haben das standard-installiert,
// Windows-CI muesste skippen. Repo laeuft aktuell nicht auf Windows-CI,
// daher kein `test.skipIf` — wenn das je dazukommt, hier Conditional-
// Skip via `which unzip`-Check ergaenzen.
describe("createZipStream :: real-decoder roundtrip (unzip shell-binary)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kumiko-zip-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function spawnUnzip(args: string[]): Promise<{ stdout: string; code: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn("unzip", args);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("close", (code) => resolve({ stdout, code: code ?? -1 }));
      proc.on("error", reject);
      // Stderr-Logging fuer Debug bei test-failures
      void stderr;
    });
  }

  test("Info-ZIP unzip -l listet die Entries korrekt", async () => {
    const zip = await collect(
      createZipStream(
        fromEntries([
          { path: "profile.json", data: fromString('{"name":"Alice"}') },
          { path: "notes/hello.txt", data: fromString("Hello world") },
        ]),
      ),
    );
    const zipPath = join(tmpDir, "test.zip");
    await writeFile(zipPath, zip);

    const { stdout, code } = await spawnUnzip(["-l", zipPath]);
    expect(code).toBe(0);
    expect(stdout).toContain("profile.json");
    expect(stdout).toContain("notes/hello.txt");
  });

  test("Info-ZIP unzip -p extrahiert exakt den Original-Body", async () => {
    const original = '{"key":"value","arr":[1,2,3]}';
    const zip = await collect(
      createZipStream(fromEntries([{ path: "data.json", data: fromString(original) }])),
    );
    const zipPath = join(tmpDir, "data.zip");
    await writeFile(zipPath, zip);

    const { stdout, code } = await spawnUnzip(["-p", zipPath, "data.json"]);
    expect(code).toBe(0);
    expect(stdout).toBe(original);
  });

  test("Info-ZIP entpackt binary-Daten (UTF-8 + non-ASCII bytes) byte-identisch", async () => {
    // Mix aus ASCII, UTF-8 (Umlaute), und non-printable Bytes
    const utf8 = new TextEncoder().encode("Strüße ümläute 🚀");
    const binary = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f]);
    const combined = new Uint8Array(utf8.byteLength + binary.byteLength);
    combined.set(utf8, 0);
    combined.set(binary, utf8.byteLength);

    const zip = await collect(
      createZipStream(fromEntries([{ path: "binary.bin", data: fromBytes(combined) }])),
    );
    const zipPath = join(tmpDir, "binary.zip");
    await writeFile(zipPath, zip);

    // Statt unzip -p (Stdout-Decode), entpacke in tmp und lies die
    // bytes raw zurueck. Das stellt sicher dass keine Encoding-Layer
    // die Roh-Bytes verfaelscht.
    const extractDir = join(tmpDir, "out");
    await spawnUnzip(["-d", extractDir, zipPath]);
    const { readFile } = await import("node:fs/promises");
    const extracted = await readFile(join(extractDir, "binary.bin"));
    expect(Array.from(extracted)).toEqual(Array.from(combined));
  });

  test("UTF-8 filename mit Umlauten (Bügel.pdf) wird korrekt entpackt", async () => {
    // Mit UTF-8-Flag (0x0800) im General-Purpose-Flag erwartet Info-ZIP
    // den filename als UTF-8. Ohne Flag wuerde Info-ZIP CP437
    // interpretieren, der Umlaut waere Mojibake. Pinst dass DACH-User
    // mit Umlaut-Filenames sauber exportiert werden.
    const zip = await collect(
      createZipStream(fromEntries([{ path: "Bügel.pdf", data: fromString("umlaut-content") }])),
    );
    const zipPath = join(tmpDir, "umlaut.zip");
    await writeFile(zipPath, zip);

    const extractDir = join(tmpDir, "out");
    await spawnUnzip(["-d", extractDir, zipPath]);

    const { readFile, readdir } = await import("node:fs/promises");
    const entries = await readdir(extractDir);
    expect(entries).toContain("Bügel.pdf");
    expect(await readFile(join(extractDir, "Bügel.pdf"), "utf8")).toBe("umlaut-content");
  });

  test("3-Entry-ZIP: alle Entries entpackbar + byte-identisch", async () => {
    const entries: ZipEntry[] = [
      { path: "a.json", data: fromString('{"a":1}') },
      { path: "subdir/b.json", data: fromString('{"b":2}') },
      { path: "subdir/nested/c.json", data: fromString('{"c":3}') },
    ];
    const zip = await collect(createZipStream(fromEntries(entries)));
    const zipPath = join(tmpDir, "multi.zip");
    await writeFile(zipPath, zip);

    const extractDir = join(tmpDir, "out");
    await spawnUnzip(["-d", extractDir, zipPath]);

    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(extractDir, "a.json"), "utf8")).toBe('{"a":1}');
    expect(await readFile(join(extractDir, "subdir/b.json"), "utf8")).toBe('{"b":2}');
    expect(await readFile(join(extractDir, "subdir/nested/c.json"), "utf8")).toBe('{"c":3}');
  });
});

describe("createZipStream :: mtime in UTC (Audit-Drift-Schutz)", () => {
  test("mtime wird als UTC encoded, nicht als lokale Zeitzone", async () => {
    // 2026-05-09 14:30:00 UTC = 16:30:00 CEST. Wenn die Implementation
    // auf lokal-Zeitzone (CEST-Server) liefe, kaeme als DOS-Time 16:30
    // raus. Wir pinnen 14:30 — UTC.
    const fixedUtc = getTemporal().Instant.fromEpochMilliseconds(Date.UTC(2026, 4, 9, 14, 30, 0)); // 2026-05-09 14:30:00 UTC
    const zip = await collect(
      createZipStream(fromEntries([{ path: "x.txt", data: fromString("x"), mtime: fixedUtc }])),
    );
    // DOS time im LFH bei Offset 10, DOS date bei Offset 12
    const dosTime = readU16LE(zip, 10);
    const dosDate = readU16LE(zip, 12);
    // DOS time: bits 11-15=hour, 5-10=minute, 0-4=second/2
    const hour = (dosTime >> 11) & 0x1f;
    const minute = (dosTime >> 5) & 0x3f;
    expect(hour).toBe(14);
    expect(minute).toBe(30);
    // DOS date: bits 9-15=year-1980, 5-8=month, 0-4=day
    const year = ((dosDate >> 9) & 0x7f) + 1980;
    const month = (dosDate >> 5) & 0x0f;
    const day = dosDate & 0x1f;
    expect(year).toBe(2026);
    expect(month).toBe(5);
    expect(day).toBe(9);
  });
});

describe("createZipStream :: streaming property", () => {
  test("Lazy entries (async generator mit setTimeout) werden korrekt verarbeitet", async () => {
    async function* lazyEntries(): AsyncIterable<ZipEntry> {
      await new Promise((r) => setTimeout(r, 5));
      yield { path: "lazy1.txt", data: fromString("delayed1") };
      await new Promise((r) => setTimeout(r, 5));
      yield { path: "lazy2.txt", data: fromString("delayed2") };
    }

    const zip = await collect(createZipStream(lazyEntries()));
    const eocdStart = zip.byteLength - 22;
    expect(readU16LE(zip, eocdStart + 8)).toBe(2);
  });

  test("Lazy chunks innerhalb Entry: AsyncIterable<Uint8Array> mit setTimeout", async () => {
    async function* lazyChunks(): AsyncIterable<Uint8Array> {
      await new Promise((r) => setTimeout(r, 2));
      yield new TextEncoder().encode("chunk1-");
      await new Promise((r) => setTimeout(r, 2));
      yield new TextEncoder().encode("chunk2");
    }

    const zip = await collect(
      createZipStream(fromEntries([{ path: "chunked.txt", data: lazyChunks() }])),
    );

    // Body folgt nach LFH (30 + filename)
    const filenameLen = readU16LE(zip, 26);
    const bodyStart = 30 + filenameLen;
    const totalSize = readU32LE(zip, 22); // uncompressed size
    const bodyBytes = zip.slice(bodyStart, bodyStart + totalSize);
    expect(new TextDecoder().decode(bodyBytes)).toBe("chunk1-chunk2");
  });
});
