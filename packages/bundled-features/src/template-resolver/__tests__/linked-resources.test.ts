import { describe, expect, test } from "bun:test";
import {
  fileAttachmentsOf,
  imageLinksOf,
  imageResourceKeysOf,
  parseLinkedResourceEntries,
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

  test("null, empty and invalid JSON give no entries", () => {
    expect(parseLinkedResourceEntries(null)).toEqual({});
    expect(parseLinkedResourceEntries("")).toEqual({});
    expect(parseLinkedResourceEntries("{nope")).toEqual({});
    expect(parseLinkedResourceEntries("[1]")).toEqual({});
  });
});
