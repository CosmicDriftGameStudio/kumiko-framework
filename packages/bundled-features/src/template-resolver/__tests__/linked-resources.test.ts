import { describe, expect, test } from "bun:test";
import {
  fileAttachmentsOf,
  imageLinksOf,
  imageResourceKeysOf,
  parseLinkedResourceEntries,
  pdfAttachmentLinksOf,
} from "../linked-resources";

const STORED = JSON.stringify({
  logo: "file-1",
  "b-terms": { kind: "file", fileRefId: "file-3", fileName: "terms.pdf" },
  "a-offer": { kind: "file", fileRefId: "file-2", fileName: "offer.pdf" },
  broken: { kind: "file", fileRefId: 5 },
  other: 7,
});

describe("linked resource entries", () => {
  test("parses images and file entries and drops malformed ones", () => {
    expect(Object.keys(parseLinkedResourceEntries(STORED)).sort()).toEqual([
      "a-offer",
      "b-terms",
      "logo",
    ]);
  });

  test("image links hold only the image entries", () => {
    expect(imageLinksOf(parseLinkedResourceEntries(STORED))).toEqual({ logo: "file-1" });
    expect(imageResourceKeysOf(STORED)).toEqual(["logo"]);
  });

  test("file attachments come back sorted by key", () => {
    expect(fileAttachmentsOf(parseLinkedResourceEntries(STORED))).toEqual([
      { kind: "file", fileRefId: "file-2", fileName: "offer.pdf" },
      { kind: "file", fileRefId: "file-3", fileName: "terms.pdf" },
    ]);
  });

  test("parses rendered PDF links and returns them sorted by key", () => {
    const stored = JSON.stringify({
      "b-copy": { kind: "rendered-pdf", templateSlug: "billing:invoice", fileName: "b-{{n}}.pdf" },
      "a-main": { kind: "rendered-pdf", templateSlug: "billing:invoice", fileName: "a.PDF" },
      logo: "file-1",
      doc: { kind: "file", fileRefId: "file-2", fileName: "terms.pdf" },
    });
    const entries = parseLinkedResourceEntries(stored);
    expect(pdfAttachmentLinksOf(entries).map((link) => link.fileName)).toEqual([
      "a.PDF",
      "b-{{n}}.pdf",
    ]);
    expect(imageLinksOf(entries)).toEqual({ logo: "file-1" });
    expect(fileAttachmentsOf(entries)).toHaveLength(1);
  });

  test("drops rendered PDF links with a bad slug, a bad file name or extra fields", () => {
    const rejected = [
      { kind: "rendered-pdf", templateSlug: "Bad Slug", fileName: "a.pdf" },
      { kind: "rendered-pdf", templateSlug: "invoice", fileName: "a.txt" },
      { kind: "rendered-pdf", templateSlug: "invoice", fileName: "../a.pdf" },
      { kind: "rendered-pdf", templateSlug: "invoice", fileName: "a/b.pdf" },
      { kind: "rendered-pdf", templateSlug: "invoice", fileName: "a\nb.pdf" },
      { kind: "rendered-pdf", templateSlug: "invoice", fileName: `${"a".repeat(200)}.pdf` },
      { kind: "rendered-pdf", templateSlug: "invoice" },
      { kind: "rendered-pdf", templateSlug: "invoice", fileName: "a.pdf", fileRefId: "x" },
    ];
    for (const entry of rejected) {
      expect(parseLinkedResourceEntries(JSON.stringify({ key: entry }))).toEqual({});
    }
  });

  test("null, empty and invalid JSON give no entries", () => {
    expect(parseLinkedResourceEntries(null)).toEqual({});
    expect(parseLinkedResourceEntries("")).toEqual({});
    expect(parseLinkedResourceEntries("{nope")).toEqual({});
    expect(parseLinkedResourceEntries("[1]")).toEqual({});
  });
});
