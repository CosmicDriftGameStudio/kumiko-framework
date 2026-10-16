import { describe, expect, test } from "bun:test";
import { MAX_EMAIL_ATTACHMENTS } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { RendererError } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { combineMailAttachments } from "../mail-attachments";

const inlineRef = (index: number) => ({
  kind: "inline" as const,
  cid: `img${index}`,
  fileRefId: `i${index}`,
});
const fileRef = (index: number) => ({
  kind: "file" as const,
  fileRefId: `f${index}`,
  fileName: `a${index}.pdf`,
});

describe("combineMailAttachments", () => {
  test("puts inline images before files", () => {
    expect(combineMailAttachments("s", [inlineRef(1)], [fileRef(1)])).toEqual([
      inlineRef(1),
      fileRef(1),
    ]);
  });

  test("accepts exactly the limit", () => {
    const files = Array.from({ length: MAX_EMAIL_ATTACHMENTS - 1 }, (_, i) => fileRef(i));
    expect(combineMailAttachments("s", [inlineRef(1)], files)).toHaveLength(MAX_EMAIL_ATTACHMENTS);
  });

  test("throws a RendererError naming the slug when inline plus files exceed the limit", () => {
    const files = Array.from({ length: MAX_EMAIL_ATTACHMENTS }, (_, i) => fileRef(i));
    const thrown = (() => {
      try {
        combineMailAttachments("invoice", [inlineRef(1)], files);
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(thrown).toBeInstanceOf(RendererError);
    expect((thrown as RendererError).message).toContain('"invoice"');
  });
});
