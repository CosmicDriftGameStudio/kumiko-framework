import { describe, expect, test } from "bun:test";
import { readZipEntryNames } from "../zip-entry-names.ts";

function centralHeader(name: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(28, nameBytes.length, true);
  header.set(nameBytes, 46);
  return header;
}

function eocd(entryCount: number, centralOffset: number, comment: Uint8Array): Uint8Array {
  const record = new Uint8Array(22 + comment.length);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, comment.length, true);
  record.set(comment, 22);
  return record;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe("readZipEntryNames", () => {
  test("reads names from the central directory", () => {
    const central = centralHeader("word/document.xml");
    const zip = concat(central, eocd(1, 0, new Uint8Array()));
    expect(readZipEntryNames(zip)).toEqual(["word/document.xml"]);
  });

  test("an archive comment containing an EOCD signature does not hide the real entries", () => {
    const central = centralHeader("word/document.xml");
    // Fake record claims zero entries and is followed by trailing bytes, so its
    // own comment length does not reach the end of the buffer.
    const fake = eocd(0, 0, new Uint8Array());
    const comment = concat(fake, new Uint8Array([1, 2, 3]));
    const zip = concat(central, eocd(1, 0, comment));
    expect(readZipEntryNames(zip)).toEqual(["word/document.xml"]);
  });

  test("returns null when no EOCD ends exactly at the buffer end", () => {
    const zip = concat(centralHeader("a"), eocd(1, 0, new Uint8Array()), new Uint8Array([9]));
    expect(readZipEntryNames(zip)).toBeNull();
  });
});
