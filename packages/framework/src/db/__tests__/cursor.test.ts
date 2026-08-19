import { describe, expect, test } from "bun:test";
import { decodeCursor, decodeKeysetCursor, encodeCursor, encodeKeysetCursor } from "../cursor";

describe("encodeCursor / decodeCursor", () => {
  test("round-trips string ids", () => {
    const id = "0194a1b2-c3d4-7890-abcd-ef1234567890";
    expect(decodeCursor(encodeCursor(id))).toBe(id);
  });

  test("round-trips numeric ids", () => {
    expect(decodeCursor(encodeCursor(42))).toBe("42");
  });

  test("decodeCursor throws on empty payload", () => {
    expect(() => decodeCursor(encodeCursor(""))).toThrow(/Invalid cursor/);
  });
});

describe("encodeKeysetCursor / decodeKeysetCursor", () => {
  test("round-trips a sort value alongside the id", () => {
    const id = "0194a1b2-c3d4-7890-abcd-ef1234567890";
    const decoded = decodeKeysetCursor(encodeKeysetCursor("2026-03-01", id));
    expect(decoded).toEqual({ id, sortValue: "2026-03-01" });
  });

  test("round-trips a null sort value as null, not undefined", () => {
    const id = "0194a1b2-c3d4-7890-abcd-ef1234567890";
    const decoded = decodeKeysetCursor(encodeKeysetCursor(null, id));
    expect(decoded.sortValue).toBeNull();
  });

  test("decodes a legacy id-only cursor with sortValue undefined", () => {
    const decoded = decodeKeysetCursor(encodeCursor("abc-123"));
    expect(decoded).toEqual({ id: "abc-123", sortValue: undefined });
  });

  test("treats a JSON payload that isn't a valid keyset cursor as a legacy id", () => {
    const cursor = encodeCursor('{"nope":1}');
    expect(() => decodeKeysetCursor(cursor)).not.toThrow();
    expect(decodeKeysetCursor(cursor)).toEqual({ id: '{"nope":1}', sortValue: undefined });
  });
});
