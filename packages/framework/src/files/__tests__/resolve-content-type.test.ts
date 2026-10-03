import { describe, expect, test } from "bun:test";
import { resolveContentType } from "../resolve-content-type.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const OCTET = "application/octet-stream";

describe("resolveContentType", () => {
  test("octet-stream XML resolves to application/xml", () => {
    const bytes = encode('<?xml version="1.0"?><Invoice/>');
    expect(resolveContentType({ declared: OCTET, bytes, filename: "invoice" })).toBe(
      "application/xml",
    );
  });

  test("XML behind a BOM and whitespace, without declaration, is still XML", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encode("  \n<Invoice><a/></Invoice>")]);
    expect(resolveContentType({ declared: "", bytes, filename: undefined })).toBe(
      "application/xml",
    );
  });

  test("octet-stream PDF resolves to application/pdf", () => {
    const bytes = encode("%PDF-1.7\n...");
    expect(resolveContentType({ declared: OCTET, bytes, filename: "scan.bin" })).toBe(
      "application/pdf",
    );
  });

  test("content wins over a misleading extension", () => {
    const bytes = encode("%PDF-1.4");
    expect(resolveContentType({ declared: OCTET, bytes, filename: "invoice.xml" })).toBe(
      "application/pdf",
    );
  });

  test("PNG, JPEG, GIF signatures resolve", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const gif = encode("GIF89a...");
    expect(resolveContentType({ declared: OCTET, bytes: png, filename: "a" })).toBe("image/png");
    expect(resolveContentType({ declared: OCTET, bytes: jpeg, filename: "a" })).toBe("image/jpeg");
    expect(resolveContentType({ declared: OCTET, bytes: gif, filename: "a" })).toBe("image/gif");
  });

  test("ZIP bytes are application/zip, not docx", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(resolveContentType({ declared: OCTET, bytes, filename: "archive" })).toBe(
      "application/zip",
    );
  });

  test("unrecognised content falls back to the extension", () => {
    const bytes = encode("a,b\n1,2\n");
    expect(resolveContentType({ declared: OCTET, bytes, filename: "export.CSV" })).toBe("text/csv");
  });

  test("unknown content without a known extension stays octet-stream", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(resolveContentType({ declared: OCTET, bytes, filename: "blob.dat" })).toBe(OCTET);
    expect(resolveContentType({ declared: undefined, bytes, filename: undefined })).toBe(OCTET);
  });

  test("binary data with a leading angle bracket is not XML", () => {
    const bytes = new Uint8Array([0x3c, 0x00, 0x3f, 0x00]);
    expect(resolveContentType({ declared: OCTET, bytes, filename: "x" })).toBe(OCTET);
  });

  test("HTML is not relabelled as XML", () => {
    const bytes = encode("<html><body>hi</body></html>");
    expect(resolveContentType({ declared: OCTET, bytes, filename: "x" })).toBe(OCTET);
  });

  test("a concrete declared type is never overridden", () => {
    const pdfBytes = encode("%PDF-1.7");
    const xmlBytes = encode("<?xml version='1.0'?><a/>");
    expect(resolveContentType({ declared: "text/plain", bytes: pdfBytes, filename: "a.pdf" })).toBe(
      "text/plain",
    );
    expect(resolveContentType({ declared: "image/png", bytes: xmlBytes, filename: "a.xml" })).toBe(
      "image/png",
    );
  });

  test("declared type with parameters counts as concrete", () => {
    const bytes = encode("%PDF-1.7");
    expect(
      resolveContentType({ declared: "text/plain; charset=utf-8", bytes, filename: "a" }),
    ).toBe("text/plain; charset=utf-8");
  });
});
