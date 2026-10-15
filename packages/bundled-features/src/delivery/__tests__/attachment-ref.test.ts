import { describe, expect, test } from "bun:test";
import { emailAttachmentRefSchema, toAttachmentRef } from "../attachment-ref.js";

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
