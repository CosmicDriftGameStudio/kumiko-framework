import { describe, expect, test } from "bun:test";
import { withoutAmbientTemporal } from "../../testing/without-ambient-temporal";
import { ensureTemporalPolyfill, getTemporal } from "../polyfill";

describe("ensureTemporalPolyfill — re-install after teardown", () => {
  test("re-assigns globalThis.Temporal after delete", async () => {
    await ensureTemporalPolyfill();
    expect("Temporal" in globalThis).toBe(true);

    await withoutAmbientTemporal(async () => {
      expect("Temporal" in globalThis).toBe(false);
      await ensureTemporalPolyfill();
      expect("Temporal" in globalThis).toBe(true);
      expect(getTemporal().Now.instant().toString()).toMatch(/Z$/);
    });
  });
});
