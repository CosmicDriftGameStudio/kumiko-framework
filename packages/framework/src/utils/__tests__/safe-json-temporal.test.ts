import { describe, expect, test } from "bun:test";
import { Temporal as PolyfillTemporal } from "temporal-polyfill";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { stringifyJson } from "../safe-json";

describe("stringifyJson — Temporal.Instant (native + polyfill)", () => {
  test("serializes polyfill Instant", () => {
    const instant = PolyfillTemporal.Instant.from("2026-01-01T00:00:00Z");
    expect(stringifyJson({ at: instant })).toBe('{"at":"2026-01-01T00:00:00Z"}');
  });

  test("serializes ambient/native Instant when present", async () => {
    await ensureTemporalPolyfill();
    const T = (globalThis as unknown as { Temporal: typeof PolyfillTemporal }).Temporal;
    const instant = T.Instant.from("2026-06-15T12:00:00Z");
    expect(stringifyJson({ at: instant })).toBe('{"at":"2026-06-15T12:00:00Z"}');
  });
});
