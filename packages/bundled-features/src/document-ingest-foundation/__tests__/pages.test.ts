import { describe, expect, test } from "bun:test";
import type { IngestPage } from "../entity";
import { readIngestPages, writeIngestPages } from "../pages";

const SAMPLE: readonly IngestPage[] = [
  { pageNumber: 1, text: "Hello" },
  { pageNumber: 2, text: "World" },
];

describe("writeIngestPages / readIngestPages", () => {
  test("round-trips an IngestPage[] through the longText wire format", () => {
    const raw = writeIngestPages(SAMPLE);
    expect(typeof raw).toBe("string");
    expect(readIngestPages(raw)).toEqual([...SAMPLE]);
  });

  test("writeIngestPages emits JSON an encrypted longText field can store", () => {
    expect(writeIngestPages([])).toBe("[]");
    expect(JSON.parse(writeIngestPages(SAMPLE))).toEqual([...SAMPLE]);
  });

  test("readIngestPages accepts an already-parsed array (legacy jsonb / raw SQL)", () => {
    expect(readIngestPages([...SAMPLE])).toEqual([...SAMPLE]);
  });

  test("readIngestPages drops malformed entries and tolerates null/garbage", () => {
    expect(readIngestPages(null)).toEqual([]);
    expect(readIngestPages(undefined)).toEqual([]);
    expect(readIngestPages("{not-json")).toEqual([]);
    expect(readIngestPages({ pageNumber: 1 })).toEqual([]);
    expect(
      readIngestPages(
        JSON.stringify([{ pageNumber: 1, text: "ok" }, { pageNumber: "x" }, null, "nope"]),
      ),
    ).toEqual([{ pageNumber: 1, text: "ok" }]);
  });
});
