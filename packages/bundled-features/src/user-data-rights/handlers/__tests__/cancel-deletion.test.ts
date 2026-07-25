// kumiko-framework#1525: isWithinGracePeriod is the extracted seam for
// cancel-deletion.write.ts's Temporal.Instant.compare call — the write
// handler itself has no seam short of a full dispatcher round-trip (which
// would also delete the ambient global out from under buildHandlerContext's
// unrelated ctx.tz setup; see request-cancel-deletion.integration.test.ts
// for the end-to-end coverage of this handler with Temporal intact).

import { describe, expect, test } from "bun:test";
import { Temporal as TemporalPolyfill } from "temporal-polyfill";
import { isWithinGracePeriod } from "../cancel-deletion.write";

describe("isWithinGracePeriod — kumiko-framework#1525: no ambient Temporal global", () => {
  test("null gracePeriodEnd → false, without relying on globalThis.Temporal", () => {
    const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
    delete (globalThis as { Temporal?: unknown }).Temporal;
    try {
      expect(isWithinGracePeriod(null)).toBe(false);
    } finally {
      if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
      else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
    }
  });

  test("future vs. past gracePeriodEnd, without relying on globalThis.Temporal", () => {
    // @cast-boundary temporal-polyfill-vs-ambient: same runtime object as
    // isWithinGracePeriod's own cast — see cancel-deletion.write.ts.
    const future = TemporalPolyfill.Now.instant().add({
      hours: 1,
    }) as unknown as Temporal.Instant;
    const past = TemporalPolyfill.Now.instant().subtract({
      hours: 1,
    }) as unknown as Temporal.Instant;

    const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
    delete (globalThis as { Temporal?: unknown }).Temporal;
    try {
      expect(isWithinGracePeriod(future)).toBe(true);
      expect(isWithinGracePeriod(past)).toBe(false);
    } finally {
      if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
      else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
    }
  });
});
