import { describe, expect, test } from "bun:test";
import {
  emailAttachmentRefSchema,
  MAX_RENDERED_PDF_VARIABLES_BYTES,
  toAttachmentRef,
} from "../attachment-ref.js";

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

describe("email attachment refs carry no bytes", () => {
  test("toAttachmentRef drops content a caller attached to an inline ref", () => {
    const inlineWithBytes = {
      kind: "inline" as const,
      cid: "logo",
      fileRefId: "file-ref-1",
      content: BYTES,
      contentType: "image/png",
    };
    expect(toAttachmentRef(inlineWithBytes)).toEqual({
      kind: "inline",
      cid: "logo",
      fileRefId: "file-ref-1",
    });
  });

  test("toAttachmentRef drops content a caller attached to a file ref", () => {
    const fileWithBytes = {
      kind: "file" as const,
      fileRefId: "file-ref-2",
      fileName: "invoice.pdf",
      content: BYTES,
      contentType: "application/pdf",
    };
    expect(toAttachmentRef(fileWithBytes)).toEqual({
      kind: "file",
      fileRefId: "file-ref-2",
      fileName: "invoice.pdf",
    });
  });

  test("the send payload schema rejects a ref that still carries bytes", () => {
    const parsed = emailAttachmentRefSchema.safeParse({
      kind: "file",
      fileRefId: "file-ref-2",
      fileName: "invoice.pdf",
      content: Array.from(BYTES),
    });
    expect(parsed.success).toBe(false);
  });

  test("the send payload schema accepts a plain ref", () => {
    expect(
      emailAttachmentRefSchema.safeParse({ kind: "inline", cid: "logo", fileRefId: "file-ref-1" })
        .success,
    ).toBe(true);
  });
});

describe("rendered-pdf attachment refs", () => {
  const valid = {
    kind: "rendered-pdf" as const,
    templateSlug: "invoice",
    variables: { number: "R-1" },
    fileName: "Rechnung.pdf",
    locale: "de",
  };

  test("accepts a plain rendered-pdf ref", () => {
    expect(emailAttachmentRefSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects variables above the byte limit", () => {
    const tooBig = { ...valid, variables: { blob: "x".repeat(MAX_RENDERED_PDF_VARIABLES_BYTES) } };
    expect(emailAttachmentRefSchema.safeParse(tooBig).success).toBe(false);
  });

  test("rejects a file name with a path separator or without .pdf", () => {
    expect(emailAttachmentRefSchema.safeParse({ ...valid, fileName: "a/b.pdf" }).success).toBe(
      false,
    );
    expect(emailAttachmentRefSchema.safeParse({ ...valid, fileName: "invoice.txt" }).success).toBe(
      false,
    );
  });

  test("rejects foreign fields such as bytes", () => {
    expect(emailAttachmentRefSchema.safeParse({ ...valid, content: [1, 2] }).success).toBe(false);
  });

  test("toAttachmentRef keeps only the contract fields", () => {
    const withBytes = { ...valid, content: BYTES };
    expect(toAttachmentRef(withBytes)).toEqual(valid);
  });
});
