// kumiko-framework#1525: parseJobInstant is the extracted seam for the five
// value-position Temporal.Instant.from call sites inside feature.ts's
// defineApply callbacks (no exported seam there) — must not rely on
// globalThis.Temporal.

import { describe, expect, test } from "bun:test";
import { parseJobInstant } from "../job-instant";

describe("parseJobInstant — kumiko-framework#1525: no ambient Temporal global", () => {
  test("parses an ISO instant without relying on globalThis.Temporal", () => {
    const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
    delete (globalThis as { Temporal?: unknown }).Temporal;
    try {
      const instant = parseJobInstant("2026-01-01T00:00:00Z");
      expect(instant.toString()).toBe("2026-01-01T00:00:00Z");
    } finally {
      if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
      else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
    }
  });
});
