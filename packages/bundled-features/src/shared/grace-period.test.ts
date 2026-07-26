import { describe, expect, test } from "bun:test";
import { withoutAmbientTemporal } from "@cosmicdrift/kumiko-framework/testing";
import { Temporal as TemporalPolyfill } from "temporal-polyfill";
import { isWithinGracePeriod } from "./grace-period";

describe("isWithinGracePeriod — kumiko-framework#1525/#1550", () => {
  test("null gracePeriodEnd → false without ambient Temporal", async () => {
    await withoutAmbientTemporal(() => {
      expect(isWithinGracePeriod(null)).toBe(false);
    });
  });

  test("future vs past without ambient Temporal", async () => {
    const future = TemporalPolyfill.Now.instant().add({
      hours: 1,
    }) as unknown as Temporal.Instant;
    const past = TemporalPolyfill.Now.instant().subtract({
      hours: 1,
    }) as unknown as Temporal.Instant;

    await withoutAmbientTemporal(() => {
      expect(isWithinGracePeriod(future)).toBe(true);
      expect(isWithinGracePeriod(past)).toBe(false);
    });
  });
});
