import { describe, expect, test } from "bun:test";
import { countPdfPages } from "../pdf-page-count";

function pdf(body: string): Uint8Array {
  return new TextEncoder().encode(body);
}

describe("countPdfPages", () => {
  test("reads /Count from the page-tree root (Type before Count)", () => {
    const bytes = pdf("%PDF-1.4\n3 0 obj\n<< /Type /Pages /Kids [4 0 R 5 0 R] /Count 2 >>\nendobj");
    expect(countPdfPages(bytes)).toBe(2);
  });

  test("reads /Count when it precedes /Type /Pages", () => {
    const bytes = pdf("%PDF-1.7\n1 0 obj\n<< /Count 7 /Kids [2 0 R] /Type /Pages >>\nendobj");
    expect(countPdfPages(bytes)).toBe(7);
  });

  test("takes the max across nested page-tree nodes (root spans all pages)", () => {
    const bytes = pdf(
      "<< /Type /Pages /Count 10 /Kids [2 0 R 3 0 R] >>" +
        "<< /Type /Pages /Count 4 /Kids [] >>" +
        "<< /Type /Pages /Count 6 /Kids [] >>",
    );
    expect(countPdfPages(bytes)).toBe(10);
  });

  test("falls back to counting /Type /Page leaves when no /Count present", () => {
    const bytes = pdf(
      "<< /Type /Page /MediaBox [0 0 612 792] >>" +
        "<< /Type /Page /MediaBox [0 0 612 792] >>" +
        "<< /Type /Page /MediaBox [0 0 612 792] >>",
    );
    expect(countPdfPages(bytes)).toBe(3);
  });

  test("does not mistake /Type /Pages for a /Type /Page leaf", () => {
    const bytes = pdf("<< /Type /Pages /Kids [] >>");
    // No /Count and no /Page leaf → fallback floor of 1, not a Pages-as-leaf miscount.
    expect(countPdfPages(bytes)).toBe(1);
  });

  test("returns 1 for bytes without a parseable page-tree (floor, never 0)", () => {
    expect(countPdfPages(pdf("%PDF-"))).toBe(1);
    expect(countPdfPages(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(1);
  });

  test("survives binary stream bytes around the page-tree tokens", () => {
    const head = pdf("<< /Type /Pages /Count 5 >>stream\n");
    const binary = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0xfe]);
    const tail = pdf("\nendstream");
    const merged = new Uint8Array(head.length + binary.length + tail.length);
    merged.set(head, 0);
    merged.set(binary, head.length);
    merged.set(tail, head.length + binary.length);
    expect(countPdfPages(merged)).toBe(5);
  });
});
