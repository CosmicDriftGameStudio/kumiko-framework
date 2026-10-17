import { describe, expect, test } from "bun:test";
import { zipWithEntries } from "@cosmicdrift/kumiko-testing/helpers";
import { validateFileContent } from "../types.js";

describe("validateFileContent docx part check", () => {
  test("accepts a docx whose main part is not word/document.xml", () => {
    expect(
      validateFileContent("report.docx", zipWithEntries("word/document2.xml"), ["docx"]),
    ).toEqual({
      kind: "ok",
    });
  });

  test("rejects a ZIP without any word/ entry as content_mismatch", () => {
    const result = validateFileContent("report.docx", zipWithEntries("xl/workbook.xml"), ["docx"]);
    expect(result.kind).toBe("rejected");
    expect(result.kind === "rejected" ? result.error : "").toContain("content_mismatch");
  });

  test("rejects a ZIP whose entry merely contains 'word/' inside a longer name", () => {
    for (const entryName of ["password/a.txt", "keyword/x.xml", "xl/word/sheet.xml"]) {
      const result = validateFileContent("report.docx", zipWithEntries(entryName), ["docx"]);
      expect(result.kind).toBe("rejected");
      expect(result.kind === "rejected" ? result.error : "").toContain("content_mismatch");
    }
  });

  test("accepts a ZIP that has word/ among other entries", () => {
    const zip = zipWithEntries("[Content_Types].xml", "word/document.xml");
    expect(validateFileContent("report.docx", zip, ["docx"])).toEqual({ kind: "ok" });
  });
});
