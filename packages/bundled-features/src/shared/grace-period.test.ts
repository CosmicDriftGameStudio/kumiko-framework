import { describe, expect, test } from "bun:test";
import { withoutAmbientTemporal } from "@cosmicdrift/kumiko-testing/helpers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isWithinGracePeriod } from "./grace-period.ts";

describe("isWithinGracePeriod", () => {
  test("null gracePeriodEnd → false without ambient Temporal", async () => {
    await withoutAmbientTemporal(() => {
      expect(isWithinGracePeriod(null)).toBe(false);
    });
  });

  test("future vs past without ambient Temporal", async () => {
    const future = Temporal.Now.instant().add({ hours: 1 });
    const past = Temporal.Now.instant().subtract({ hours: 1 });

    await withoutAmbientTemporal(() => {
      expect(isWithinGracePeriod(future)).toBe(true);
      expect(isWithinGracePeriod(past)).toBe(false);
    });
  });
});
