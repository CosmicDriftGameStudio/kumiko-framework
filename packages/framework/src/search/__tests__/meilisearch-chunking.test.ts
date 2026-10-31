import { describe, expect, test } from "bun:test";
import {
  buildPieceDocuments,
  CHUNK_MAX_CHARS,
  entityPiecesFilter,
  splitLongText,
  stalePiecesFilter,
} from "../meilisearch-chunking.ts";

const filler = (words: number): string =>
  Array.from({ length: words }, (_, i) => `w${i}`).join(" ");

describe("splitLongText", () => {
  test("a short value stays one piece", () => {
    expect(splitLongText("short")).toEqual(["short"]);
  });

  test("pieces stay within the limit, cut at whitespace, and overlap", () => {
    const text = filler(60_000);
    const pieces = splitLongText(text);
    expect(pieces.length).toBeGreaterThan(30);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(piece.startsWith(" ")).toBe(false);
    }
    for (let i = 1; i < pieces.length; i++) {
      const previous = pieces[i - 1] ?? "";
      const firstWord = (pieces[i] ?? "").split(" ")[0] ?? "";
      expect(previous.endsWith(firstWord) || previous.includes(` ${firstWord} `)).toBe(true);
    }
  });

  test("every word of the text is whole in at least one piece", () => {
    const text = filler(20_000);
    const seen = new Set(splitLongText(text).flatMap((piece) => piece.split(" ")));
    for (let i = 0; i < 20_000; i += 997) expect(seen.has(`w${i}`)).toBe(true);
    expect(seen.has("w19999")).toBe(true);
  });

  test("a value without whitespace is cut hard and still makes progress", () => {
    const pieces = splitLongText("x".repeat(CHUNK_MAX_CHARS * 2 + 5));
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    expect(pieces.every((p) => p.length <= CHUNK_MAX_CHARS)).toBe(true);
  });
});

describe("buildPieceDocuments", () => {
  const entityId = "e-1";

  test("a document with only short fields is one piece with the legacy id", () => {
    const docs = buildPieceDocuments({
      entityType: "note",
      entityId,
      weight: 3,
      fields: { title: "hello" },
    });
    expect(docs).toEqual([
      {
        _id: "note_e-1",
        _type: "note",
        _weight: 3,
        _entityId: entityId,
        _chunk: 0,
        title: "hello",
      },
    ]);
  });

  test("long fields spread over pieces; short fields only sit in piece 0", () => {
    const docs = buildPieceDocuments({
      entityType: "note",
      entityId,
      weight: 1,
      fields: { title: "hello", body: filler(10_000) },
    });
    expect(docs.length).toBeGreaterThan(1);
    expect(docs.map((d) => d._id)).toEqual(
      docs.map((_, n) => (n === 0 ? "note_e-1" : `note_e-1_c${n}`)),
    );
    expect(docs[0]?.["title"]).toBe("hello");
    expect(docs[1]).not.toHaveProperty("title");
    expect(docs.every((d, n) => d["_chunk"] === n && d["_entityId"] === entityId)).toBe(true);
  });
});

describe("piece filters", () => {
  test("values are escaped", () => {
    expect(entityPiecesFilter('a"b', "x\\y")).toBe('(_type = "a\\"b" AND _entityId = "x\\\\y")');
    expect(stalePiecesFilter("t", "1", 2)).toBe(
      '(_type = "t" AND _entityId = "1" AND _chunk >= 2)',
    );
  });
});
