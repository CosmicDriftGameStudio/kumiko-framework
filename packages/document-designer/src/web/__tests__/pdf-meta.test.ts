import { describe, expect, test } from "bun:test";
import { EMPTY_PDF_META, serializePdfMeta } from "../pdf-meta.js";

describe("serializePdfMeta margins", () => {
  test("serializes only the margin sides that are set", () => {
    const meta = serializePdfMeta({
      ...EMPTY_PDF_META,
      margins: { top: "", right: "", bottom: "", left: 12 },
    });

    expect(meta["margins"]).toEqual({ left: 12 });
  });

  test("leaves margins out when none is set", () => {
    expect(serializePdfMeta(EMPTY_PDF_META)).not.toHaveProperty("margins");
  });
});
