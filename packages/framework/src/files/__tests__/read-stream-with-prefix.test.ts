import { describe, expect, test } from "bun:test";
import { readStreamWithPrefix } from "../read-stream-with-prefix.ts";
import { SNIFF_PREFIX_BYTE_COUNT, sniffMimeType } from "../types.ts";

async function* chunksOf(...chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

function sequence(length: number, start = 0): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => start + i);
}

async function collect(body: ReadableStream<Uint8Array>): Promise<number[]> {
  return Array.from(new Uint8Array(await new Response(body).arrayBuffer()));
}

describe("readStreamWithPrefix", () => {
  test("prefix spans several chunks and body replays every byte in order", async () => {
    const all = sequence(26);
    const { prefix, body } = await readStreamWithPrefix(
      chunksOf(all.slice(0, 3), all.slice(3, 6), all.slice(6)),
      12,
    );
    expect(Array.from(prefix)).toEqual(Array.from(all.slice(0, 12)));
    expect(await collect(body)).toEqual(Array.from(all));
  });

  test("a source shorter than the prefix yields all its bytes as prefix", async () => {
    const all = sequence(5);
    const { prefix, body } = await readStreamWithPrefix(chunksOf(all), 12);
    expect(Array.from(prefix)).toEqual(Array.from(all));
    expect(await collect(body)).toEqual(Array.from(all));
  });

  test("an empty source gives an empty prefix and body", async () => {
    const { prefix, body } = await readStreamWithPrefix(chunksOf(), 12);
    expect(prefix.length).toBe(0);
    expect(await collect(body)).toEqual([]);
  });

  test("a failing source rejects before a body exists, even for a one-byte prefix", async () => {
    const failure = new Error("object missing");
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield* [];
      throw failure;
    }
    await expect(readStreamWithPrefix(failing(), 1)).rejects.toBe(failure);
  });

  test("cancelling the body closes the source", async () => {
    let closed = false;
    async function* source(): AsyncGenerator<Uint8Array> {
      try {
        yield sequence(4);
        yield sequence(4);
      } finally {
        closed = true;
      }
    }
    const { body } = await readStreamWithPrefix(source(), 1);
    await body.cancel();
    expect(closed).toBe(true);
  });

  test("SNIFF_PREFIX_BYTE_COUNT covers the longest signatures (PDF header search, ISO-BMFF brands)", () => {
    const latePdf = new Uint8Array(2048);
    latePdf.set(new TextEncoder().encode("%PDF-1.7"), 1023);
    expect(sniffMimeType(latePdf.subarray(0, SNIFF_PREFIX_BYTE_COUNT))).toBe("application/pdf");

    const brands = [...Array<string>(11).fill("xxxx"), "heic"];
    const boxSize = 16 + brands.length * 4;
    const heic = new Uint8Array(boxSize + 32);
    new DataView(heic.buffer).setUint32(0, boxSize);
    const encoder = new TextEncoder();
    heic.set(encoder.encode("ftyp"), 4);
    heic.set(encoder.encode("isom"), 8);
    heic.set(encoder.encode(brands.join("")), 16);
    expect(sniffMimeType(heic.subarray(0, SNIFF_PREFIX_BYTE_COUNT))).toBe("image/heic");

    const bytes = new Uint8Array(32);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x01, 0x02, 0x03, 0x04], 4);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffMimeType(bytes.subarray(0, SNIFF_PREFIX_BYTE_COUNT))).toBe("image/webp");
  });
});
