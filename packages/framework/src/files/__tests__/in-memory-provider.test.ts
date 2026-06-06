// createInMemoryFileProvider Unit-Tests (Phase 1, test-luecken-integration).
//
// Pinnt den FileStorageProvider-Contract der In-Memory-Impl — inkl. der
// non-obvious Eigenschaften: defensive Buffer-Copies (write UND read),
// lazy readStream-throw (erst beim ersten Chunk-Pull), und die bewusst
// erkennbare memory://-Fake-URL.

import { describe, expect, test } from "bun:test";
import { createInMemoryFileProvider } from "../in-memory-provider";

const bytes = (s: string) => new TextEncoder().encode(s);
const decode = (u: Uint8Array) => new TextDecoder().decode(u);

describe("createInMemoryFileProvider — write/read roundtrip", () => {
  test("read liefert die geschriebenen Bytes zurück", async () => {
    const p = createInMemoryFileProvider();
    await p.write("a.txt", bytes("hello"));
    expect(decode(await p.read("a.txt"))).toBe("hello");
  });

  test("write kopiert defensiv — Caller-Mutation nach write ändert Storage nicht", async () => {
    const p = createInMemoryFileProvider();
    const data = bytes("orig");
    await p.write("k", data);
    data[0] = 0;
    expect(decode(await p.read("k"))).toBe("orig");
  });

  test("read kopiert defensiv — Mutation des Ergebnisses ändert Storage nicht", async () => {
    const p = createInMemoryFileProvider();
    await p.write("k", bytes("orig"));
    const first = await p.read("k");
    first[0] = 0;
    expect(decode(await p.read("k"))).toBe("orig");
  });

  test("read auf fehlenden Key wirft", async () => {
    const p = createInMemoryFileProvider();
    await expect(p.read("missing")).rejects.toThrow("in-memory file not found: missing");
  });
});

describe("createInMemoryFileProvider — writeStream/readStream", () => {
  test("writeStream fügt Chunks zusammen, readStream liest zurück", async () => {
    const p = createInMemoryFileProvider();
    async function* src() {
      yield bytes("foo");
      yield bytes("bar");
    }
    await p.writeStream("s", src());
    let out = "";
    for await (const chunk of p.readStream("s")) out += decode(chunk);
    expect(out).toBe("foobar");
  });

  test("readStream auf fehlenden Key wirft erst beim ersten Chunk-Pull (lazy, wie S3)", async () => {
    const p = createInMemoryFileProvider();
    const it = p.readStream("missing")[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toThrow("in-memory file not found: missing");
  });
});

describe("createInMemoryFileProvider — exists/delete", () => {
  test("exists spiegelt write + delete", async () => {
    const p = createInMemoryFileProvider();
    expect(await p.exists("k")).toBe(false);
    await p.write("k", bytes("x"));
    expect(await p.exists("k")).toBe(true);
    await p.delete("k");
    expect(await p.exists("k")).toBe(false);
  });

  test("delete auf fehlenden Key ist no-op", async () => {
    const p = createInMemoryFileProvider();
    await expect(p.delete("nope")).resolves.toBeUndefined();
  });
});

describe("createInMemoryFileProvider — getSignedUrl/keys/clear", () => {
  test("getSignedUrl liefert deterministische memory://-Fake-URL", async () => {
    const p = createInMemoryFileProvider();
    expect(p.getSignedUrl).toBeDefined();
    expect(await p.getSignedUrl?.("path/to/f.jpg", 300)).toBe("memory://path/to/f.jpg?expires=300");
  });

  test("keys listet geschriebene Keys, clear leert alles", async () => {
    const p = createInMemoryFileProvider();
    await p.write("a", bytes("1"));
    await p.write("b", bytes("2"));
    expect([...p.keys()].sort()).toEqual(["a", "b"]);
    p.clear();
    expect(p.keys()).toEqual([]);
  });
});
