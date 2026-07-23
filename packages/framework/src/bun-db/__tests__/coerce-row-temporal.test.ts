// kumiko-framework#1480: instantFromDriver referenced the global `Temporal`
// without importing it. Bun doesn't expose Temporal as a globalThis property
// reliably — any storeTable read of a timestamptz column crashed with
// "Temporal is not defined" unless some other boot path happened to install
// the polyfill globally first (order-dependent, easy to miss in a fresh
// process). The fix is a static `import { Temporal } from "temporal-polyfill"`
// in query.ts, so this test deletes globalThis.Temporal before calling
// coerceRow — proving the coercion no longer depends on the global at all.

import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { coerceRow, type TableInfo } from "../query";

function timestamptzTableInfo(): TableInfo {
  return {
    name: "probe",
    columnOf: (f) => f,
    pgTypeOf: (c) => (c === "updated_at" ? "timestamptz" : undefined),
    bigintJsModeOf: () => undefined,
    fieldOf: (c) => c,
    hasColumn: () => true,
  };
}

describe("coerceRow — timestamptz → Temporal.Instant", () => {
  test("coerces without relying on a global Temporal", () => {
    const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
    delete (globalThis as { Temporal?: unknown }).Temporal;
    try {
      const row = { updated_at: new Date("2026-04-18T10:00:00Z") };
      const result = coerceRow(row, timestamptzTableInfo());
      expect(result.updated_at).toBeInstanceOf(Temporal.Instant);
      expect((result.updated_at as unknown as Temporal.Instant).toString()).toBe(
        "2026-04-18T10:00:00Z",
      );
    } finally {
      if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
      else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
    }
  });
});
