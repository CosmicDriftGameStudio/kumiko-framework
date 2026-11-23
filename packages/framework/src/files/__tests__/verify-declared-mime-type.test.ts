import { describe, expect, test } from "bun:test";
import { zipWithEntries } from "@cosmicdrift/kumiko-testing/helpers";
import {
  DEFAULT_IMAGE_FIELD_ACCEPT,
  effectiveFileFieldAccept,
  sniffMimeType,
  validateFile,
  validateFileContent,
  verifyDeclaredMimeType,
} from "../types.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const PDF_BYTES = encode("%PDF-1.4 sample");
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe("verifyDeclaredMimeType", () => {
  test("HTML bytes declared as image/png are downgraded to octet-stream", () => {
    expect(verifyDeclaredMimeType("image/png", encode("<html></html>"))).toEqual({
      kind: "replaced",
      mimeType: "application/octet-stream",
    });
  });

  test("text bytes declared as application/pdf are downgraded to octet-stream", () => {
    expect(verifyDeclaredMimeType("application/pdf", encode("plain text"))).toEqual({
      kind: "replaced",
      mimeType: "application/octet-stream",
    });
  });

  test("a real PDF declared as image/png is replaced with application/pdf and its extension", () => {
    expect(verifyDeclaredMimeType("image/png", PDF_BYTES)).toEqual({
      kind: "replaced",
      mimeType: "application/pdf",
      extension: "pdf",
    });
  });

  test("a real PDF declared as image/png on a png-only field is rejected", () => {
    const result = verifyDeclaredMimeType("image/png", PDF_BYTES, ["png"]);
    expect(result.kind).toBe("rejected");
    expect(result.kind === "rejected" ? result.error : "").toContain("content_mismatch");
  });

  test("image/jpg with JPEG bytes is unchanged", () => {
    expect(verifyDeclaredMimeType("image/jpg", JPEG_BYTES)).toEqual({ kind: "unchanged" });
  });

  test("a declared type with parameters and different case is compared normalized", () => {
    expect(verifyDeclaredMimeType("image/PNG; charset=x", PNG_BYTES)).toEqual({
      kind: "unchanged",
    });
  });

  test.each(["text/html", "image/svg+xml", "application/octet-stream", "image/bmp"])(
    "%s is not verifiable and stays unchanged",
    (declared) => {
      expect(verifyDeclaredMimeType(declared, PDF_BYTES)).toEqual({ kind: "unchanged" });
      expect(verifyDeclaredMimeType(declared, encode("anything"))).toEqual({ kind: "unchanged" });
    },
  );

  test("svg declared on a field whose accept has no svg extension is downgraded", () => {
    expect(verifyDeclaredMimeType("image/svg+xml", encode("<svg/>"), ["heic"])).toEqual({
      kind: "replaced",
      mimeType: "application/octet-stream",
    });
  });

  test("svg declared on a field that accepts svg, or without accept, stays unchanged", () => {
    expect(verifyDeclaredMimeType("image/svg+xml", encode("<svg/>"), ["svg"])).toEqual({
      kind: "unchanged",
    });
    expect(verifyDeclaredMimeType("image/svg+xml", encode("<svg/>"), [])).toEqual({
      kind: "unchanged",
    });
  });

  test("types without whitelist extensions (bmp) stay unchanged under an accept", () => {
    expect(verifyDeclaredMimeType("image/bmp", encode("anything"), ["bmp"])).toEqual({
      kind: "unchanged",
    });
  });

  test("PDF bytes declared as image/png on a heic-only field are still rejected as content_mismatch", () => {
    const result = verifyDeclaredMimeType("image/png", PDF_BYTES, ["heic"]);
    expect(result.kind).toBe("rejected");
  });

  test("ZIP bytes declared as image/png are downgraded to octet-stream", () => {
    expect(verifyDeclaredMimeType("image/png", zipWithEntries("word/document.xml"))).toEqual({
      kind: "replaced",
      mimeType: "application/octet-stream",
    });
  });
});

describe("sniffMimeType tiff", () => {
  test("recognizes little and big endian tiff headers", () => {
    expect(sniffMimeType(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0]))).toBe("image/tiff");
    expect(sniffMimeType(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 8]))).toBe("image/tiff");
  });
});

describe("validateFile without extension", () => {
  test("reports the missing extension instead of '.undefined'", () => {
    const error = validateFile(
      { fileName: "photo", mimeType: "image/png", size: 1 },
      { accept: ["png"] },
    );
    expect(error).toContain("invalid_file_type");
    expect(error).toContain("no extension");
    expect(error).not.toContain("undefined");
  });
});

describe("effectiveFileFieldAccept", () => {
  test("image and images fall back to the default accept", () => {
    expect(effectiveFileFieldAccept({ type: "image" })).toBe(DEFAULT_IMAGE_FIELD_ACCEPT);
    expect(effectiveFileFieldAccept({ type: "images" })).toBe(DEFAULT_IMAGE_FIELD_ACCEPT);
  });

  test("a file field has no default", () => {
    expect(effectiveFileFieldAccept({ type: "file" })).toBeUndefined();
  });

  test("an explicit accept wins, including the empty opt-out", () => {
    expect(effectiveFileFieldAccept({ type: "image", accept: ["svg"] })).toEqual(["svg"]);
    expect(effectiveFileFieldAccept({ type: "image", accept: [] })).toEqual([]);
  });
});

describe("PDF header offset", () => {
  const withPrefix = (prefixLength: number, body: Uint8Array): Uint8Array => {
    const bytes = new Uint8Array(prefixLength + body.length).fill(0x20);
    bytes.set(body, prefixLength);
    return bytes;
  };

  test("a PDF with bytes before the header within the first 1024 bytes sniffs as PDF", () => {
    expect(sniffMimeType(withPrefix(1, PDF_BYTES))).toBe("application/pdf");
    expect(sniffMimeType(withPrefix(1023, PDF_BYTES))).toBe("application/pdf");
    expect(validateFileContent("offer.pdf", withPrefix(300, PDF_BYTES))).toEqual({ kind: "ok" });
  });

  test("a header starting at byte 1024 or later is not a PDF", () => {
    expect(sniffMimeType(withPrefix(1024, PDF_BYTES))).toBeNull();
    expect(validateFileContent("offer.pdf", withPrefix(1024, PDF_BYTES)).kind).toBe("rejected");
  });

  test("a file with a signature at byte 0 keeps its type despite an embedded PDF header", () => {
    const pngWithPdf = new Uint8Array([...PNG_BYTES, ...PDF_BYTES]);
    expect(sniffMimeType(pngWithPdf)).toBe("image/png");
  });
});

describe("PDF header inside text", () => {
  // Accepted trade-off of the 1024-byte search: a text file that quotes the header near its start
  // sniffs as PDF, so a csv doing so is refused as binary.
  test("a csv quoting %PDF- in its first bytes is rejected as a binary format", () => {
    const csv = encode("name;note\nscan;starts with %PDF-1.4\n");
    expect(validateFileContent("export.csv", csv).kind).toBe("rejected");
  });
});
