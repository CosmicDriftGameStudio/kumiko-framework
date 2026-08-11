import { describe, expect, test } from "bun:test";
import { Temporal as PolyfillTemporal } from "temporal-polyfill";
import { withoutAmbientTemporal } from "../../testing/without-ambient-temporal";
import { stringifyJson } from "../safe-json";

describe("stringifyJson — Temporal.Instant without ambient Temporal", () => {
  test("serializes polyfill Instant when globalThis.Temporal is missing", async () => {
    const instant = PolyfillTemporal.Instant.from("2026-01-01T00:00:00Z");
    await withoutAmbientTemporal(() => {
      // Must not ReferenceError on bare Temporal (old instanceof branch).
      expect(stringifyJson({ at: instant })).toBe('{"at":"2026-01-01T00:00:00Z"}');
    });
  });
});

describe("stringifyJson — Temporal.PlainDate (kumiko-framework#1924)", () => {
  test("serializes to yyyy-mm-dd via PlainDate's own toJSON(), no special-casing needed", () => {
    const day = PolyfillTemporal.PlainDate.from("2026-03-15");
    expect(stringifyJson({ publishedAt: day })).toBe('{"publishedAt":"2026-03-15"}');
  });

  test("serializes polyfill PlainDate when globalThis.Temporal is missing", async () => {
    const day = PolyfillTemporal.PlainDate.from("2026-03-15");
    await withoutAmbientTemporal(() => {
      expect(stringifyJson({ publishedAt: day })).toBe('{"publishedAt":"2026-03-15"}');
    });
  });
});
