import { describe, expect, test } from "bun:test";
import type { SheetData } from "write-excel-file/node";
import { guardSheetAgainstCiphertext } from "../export-ciphertext-guard.ts";

const CIPHERTEXT = `kumiko-pii:v1:user:abc:${"A".repeat(44)}`;

function sheetWith(value: string): SheetData {
  return [[{ value: "Name", type: String }], [{ value, type: String }]];
}

describe("guardSheetAgainstCiphertext", () => {
  test("throws outside production when a cell looks like a PII ciphertext", () => {
    expect(() => guardSheetAgainstCiphertext(sheetWith(CIPHERTEXT), false)).toThrow(
      /PII ciphertext/,
    );
  });

  test("throws for a ciphertext in a header cell", () => {
    expect(() =>
      guardSheetAgainstCiphertext([[{ value: CIPHERTEXT, type: String }]], false),
    ).toThrow(/PII ciphertext/);
  });

  test("redacts the ciphertext in production and keeps the surrounding text", () => {
    const guarded = guardSheetAgainstCiphertext(sheetWith(`note ${CIPHERTEXT} end`), true);
    expect(guarded[1]?.[0]).toMatchObject({ value: "note [pii-redacted] end" });
  });

  test("leaves ordinary text and a user-typed prefix alone", () => {
    const sheet = sheetWith("kumiko-pii:v1 is just a phrase");
    expect(guardSheetAgainstCiphertext(sheet, false)).toEqual(sheet);
  });
});
