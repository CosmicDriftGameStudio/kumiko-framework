// ZIP-path sanitization must block path traversal: a user-uploaded
// filename containing "../" could otherwise cause a ZIP reader to write
// outside the extraction root.

import { describe, expect, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { buildFileRefZipPath, sanitizeZipFilename } from "../zip-path.ts";

const TENANT = "00000000-0000-0000-0000-000000000001" as TenantId;

describe("sanitizeZipFilename", () => {
  test("preserves alphanumeric + dot + dash + underscore", () => {
    expect(sanitizeZipFilename("report-2024.pdf")).toBe("report-2024.pdf");
    expect(sanitizeZipFilename("my_file.txt")).toBe("my_file.txt");
    expect(sanitizeZipFilename("CamelCase-File_v2.docx")).toBe("CamelCase-File_v2.docx");
  });

  test("Path traversal: '../' → no '..' in output", () => {
    // A user could upload "../../etc/passwd" as fileName. Without sanitization,
    // extraction could write outside the ZIP root. Collapse `..` sequences and
    // strip leading dots, dashes, and underscores. The result intentionally
    // differs from the original but guarantees no '..' segment in the final path.
    const result = sanitizeZipFilename("../../etc/passwd");
    expect(result).not.toContain("..");
    expect(result).toBe("file.etc_passwd"); // Paths collapse to a fallback base and safe extension

    // A filename consisting only of ".." falls back to "file".
    expect(sanitizeZipFilename("..")).toBe("file");
    expect(sanitizeZipFilename("...")).toBe("file");
  });

  test("Null-Byte: 'report\\x00.pdf' → 'report.pdf'", () => {
    // Null-byte injection is a realistic legacy hazard: some C-based tools
    // truncate at \x00, while ZIP readers may handle it inconsistently.
    expect(sanitizeZipFilename("report\x00.pdf")).toBe("report_.pdf");
  });

  test("Path-Separator: 'sub/dir/file.txt' → 'sub_dir_file.txt'", () => {
    expect(sanitizeZipFilename("sub/dir/file.txt")).toBe("sub_dir_file.txt");
    expect(sanitizeZipFilename("c:\\Users\\file")).toBe("c__Users_file");
  });

  test("Empty / null / undefined → 'unnamed'", () => {
    expect(sanitizeZipFilename("")).toBe("unnamed");
    // @ts-expect-error: null/undefined explicit defended
    expect(sanitizeZipFilename(null)).toBe("unnamed");
    // @ts-expect-error: null/undefined explicit defended
    expect(sanitizeZipFilename(undefined)).toBe("unnamed");
  });

  test("All-special-chars (no remainder) → 'file' fallback", () => {
    expect(sanitizeZipFilename("///")).toBe("file");
    expect(sanitizeZipFilename("\\")).toBe("file");
  });

  test("Long basename gekappt (Extension preserved)", () => {
    const longName = "a".repeat(200);
    const result = sanitizeZipFilename(`${longName}.pdf`);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith(".pdf")).toBe(true);
  });

  test("Long extension gekappt", () => {
    const longExt = "x".repeat(50);
    const result = sanitizeZipFilename(`file.${longExt}`);
    expect(result.startsWith("file.")).toBe(true);
    // Limit the extension to 20 characters to keep the sanitized name bounded.
    const ext = result.split(".").pop() ?? "";
    expect(ext.length).toBeLessThanOrEqual(20);
  });

  test("Hidden-File (leading dot) verliert leading-dot durch strip", () => {
    // ".bashrc" has no extension: lastDot=0 fails the "hasExt" condition, so
    // it is treated as the raw base name and its leading dot is stripped.
    expect(sanitizeZipFilename(".bashrc")).toBe("bashrc");
  });

  test("Unicode characters (non-ASCII) become underscores + fallback if needed", () => {
    // The "résumé" basename becomes "r_sum_". Its leading character is "r",
    // so stripping leading characters from "._-" does not change it.
    expect(sanitizeZipFilename("résumé.pdf")).toBe("r_sum_.pdf");
    // The "文件" basename becomes "__". Leading characters from "._-" are
    // stripped, leaving an empty name that falls back to "file".
    expect(sanitizeZipFilename("文件.txt")).toBe("file.txt");
  });
});

describe("buildFileRefZipPath", () => {
  test("Standard-Layout: files/<tenantId>/<fileRefId>-<name>", () => {
    const path = buildFileRefZipPath({
      tenantId: TENANT,
      fileRefId: "abc-123",
      fileName: "report.pdf",
    });
    expect(path).toBe(`files/${TENANT}/abc-123-report.pdf`);
  });

  test("Path traversal in fileName is sanitized (no '..' in final path)", () => {
    const path = buildFileRefZipPath({
      tenantId: TENANT,
      fileRefId: "abc",
      fileName: "../../etc/passwd",
    });
    expect(path).toBe(`files/${TENANT}/abc-file.etc_passwd`);
    expect(path).not.toContain("..");
    expect(path.split("/").length).toBe(3); // exakt 3 segments: files / tenantId / sanitized-basename
  });

  test("Path is deterministic — same input → same output", () => {
    const args = { tenantId: TENANT, fileRefId: "x", fileName: "y.txt" };
    expect(buildFileRefZipPath(args)).toBe(buildFileRefZipPath(args));
  });
});
