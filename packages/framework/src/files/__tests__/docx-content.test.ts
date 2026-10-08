import { describe, expect, test } from "bun:test";
import { validateFileContent } from "../types.js";

function zipWithEntry(entryName: string): Uint8Array {
  return new Uint8Array([
    0x50,
    0x4b,
    0x03,
    0x04,
    ...Array(20).fill(0),
    ...new TextEncoder().encode(entryName),
  ]);
}

describe("validateFileContent docx part check", () => {
  test("accepts a docx whose main part is not word/document.xml", () => {
    expect(
      validateFileContent("report.docx", zipWithEntry("word/document2.xml"), ["docx"]),
    ).toEqual({
      kind: "ok",
    });
  });

  test("rejects a ZIP without any word/ entry as content_mismatch", () => {
    const result = validateFileContent("report.docx", zipWithEntry("xl/workbook.xml"), ["docx"]);
    expect(result.kind).toBe("rejected");
    expect(result.kind === "rejected" ? result.error : "").toContain("content_mismatch");
  });
});
