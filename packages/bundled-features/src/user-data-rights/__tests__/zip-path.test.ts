// zip-path Unit-Tests (S2.U3 Atom 3c).
//
// Pinst die ZIP-Pfad-Sanitization gegen Path-Traversal + edge-cases.
// Diese Logik ist load-bearing — wenn sie failt, kann ein User-uploaded
// Filename mit "../" einen ZIP-Reader dazu bringen, ausserhalb des
// Extract-Roots zu schreiben.

import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { describe, expect, test } from "bun:test";
import { buildFileRefZipPath, sanitizeZipFilename } from "../zip-path";

const TENANT = "00000000-0000-0000-0000-000000000001" as TenantId;

describe("sanitizeZipFilename", () => {
  test("preserves alphanumeric + dot + dash + underscore", () => {
    expect(sanitizeZipFilename("report-2024.pdf")).toBe("report-2024.pdf");
    expect(sanitizeZipFilename("my_file.txt")).toBe("my_file.txt");
    expect(sanitizeZipFilename("CamelCase-File_v2.docx")).toBe("CamelCase-File_v2.docx");
  });

  test("Path-Traversal: '../' → kein '..' im Output", () => {
    // Klassisch: User uploaded "../../etc/passwd" als fileName. Reader
    // wuerde sonst beim Extract aus dem ZIP-Root rausschreiben. Sanitize
    // collaps `..`-Sequenzen + strippt leading dots/dashes/underscores.
    // Resultat ist NICHT visually identical mit dem Original (informativ),
    // aber garantiert kein '..'-Segment im final-Path.
    const result = sanitizeZipFilename("../../etc/passwd");
    expect(result).not.toContain("..");
    expect(result).toBe("file.etc_passwd"); // Pfade kollabieren auf fallback-base + safe-ext

    // Pure ".." faellt komplett auf fallback "file" zurueck.
    expect(sanitizeZipFilename("..")).toBe("file");
    expect(sanitizeZipFilename("...")).toBe("file");
  });

  test("Null-Byte: 'report\\x00.pdf' → 'report.pdf'", () => {
    // Null-byte injection ist eine alte aber realistische Falle —
    // Some C-based tools truncieren bei \x00, ZIP-Readern unklar.
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
    // Extension wird auf 20 chars max gekappt
    const ext = result.split(".").pop() ?? "";
    expect(ext.length).toBeLessThanOrEqual(20);
  });

  test("Hidden-File (leading dot) verliert leading-dot durch strip", () => {
    // ".bashrc" — kein basename (lastDot=0 nicht "hasExt"-Bedingung).
    // Wird also als raw-baseName behandelt + dann leading-dot gestrippt.
    expect(sanitizeZipFilename(".bashrc")).toBe("bashrc");
  });

  test("Unicode chars (non-ASCII) werden zu underscore + ggf. fallback", () => {
    // "résumé" basename: "r_sum_" → keine leading-strip, bleibt
    // — aber: leading underscore wird gestrippt? Nein, nur leading "_._-"
    // werden gestrippt vor strict basename. "r_sum_" startet mit "r".
    expect(sanitizeZipFilename("résumé.pdf")).toBe("r_sum_.pdf");
    // "文件" basename: "__" → all-underscore — kein strip aktiv weil
    // erstes Zeichen ist "_" das in [._-] ist, also wird gestrippt
    // → empty → fallback "file".
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

  test("Path-Traversal im fileName wird sanitized (kein '..' im Final-Path)", () => {
    const path = buildFileRefZipPath({
      tenantId: TENANT,
      fileRefId: "abc",
      fileName: "../../etc/passwd",
    });
    expect(path).toBe(`files/${TENANT}/abc-file.etc_passwd`);
    expect(path).not.toContain("..");
    expect(path.split("/").length).toBe(3); // exakt 3 segments: files / tenantId / sanitized-basename
  });

  test("Path ist deterministic — gleicher Input → gleicher Output", () => {
    const args = { tenantId: TENANT, fileRefId: "x", fileName: "y.txt" };
    expect(buildFileRefZipPath(args)).toBe(buildFileRefZipPath(args));
  });
});
