// kumiko-framework#1480 twin bug: instantToDriver referenced the global
// `Temporal` the same way instantFromDriver in bun-db/query.ts did. Fixed
// the same way — static `import { Temporal } from "temporal-polyfill"` in
// dialect.ts. This test deletes globalThis.Temporal before calling it,
// proving the write path no longer depends on the global either.

import { describe, expect, test } from "bun:test";
import { instantToDriver } from "../dialect";

describe("instantToDriver — without a global Temporal", () => {
  test("coerces an ISO string without relying on a global Temporal", () => {
    const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
    delete (globalThis as { Temporal?: unknown }).Temporal;
    try {
      expect(instantToDriver("2026-04-18T10:00:00Z")).toBe("2026-04-18T10:00:00Z");
    } finally {
      if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
      else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
    }
  });
});
