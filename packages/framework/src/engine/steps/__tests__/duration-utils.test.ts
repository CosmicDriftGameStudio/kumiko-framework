// kumiko-framework#1525: addDuration must not rely on globalThis.Temporal —
// it's a pure free function called from step handlers before boot may have
// run ensureTemporalPolyfill() on every code path.

import { describe, expect, test } from "bun:test";
import { addDuration } from "../_duration-utils";

describe("addDuration — kumiko-framework#1525: no ambient Temporal global", () => {
  test("adds a duration without relying on globalThis.Temporal", () => {
    const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
    delete (globalThis as { Temporal?: unknown }).Temporal;
    try {
      const result = addDuration("2026-01-01T00:00:00Z", "P1DT1H");
      expect(result).toBe("2026-01-02T01:00:00Z");
    } finally {
      if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
      else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
    }
  });
});
