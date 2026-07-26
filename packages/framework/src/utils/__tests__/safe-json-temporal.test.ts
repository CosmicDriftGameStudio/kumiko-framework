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
