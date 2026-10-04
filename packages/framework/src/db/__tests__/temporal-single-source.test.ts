// Consumers validate with `z.instanceof(Temporal.Instant)` against the global
// Temporal; framework-made instants from a different class (polyfill copy next
// to a native global) fail with "expected Instant, received Instant".

import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { coerceRow, type TableInfo } from "../../bun-db/query.js";

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

describe("row coercion uses the global Temporal classes", () => {
  test.each([
    ["Date from the driver", new Date("2026-04-18T10:00:00Z")],
    ["ISO string from the driver", "2026-04-18T10:00:00Z"],
  ])(
    "timestamptz %s passes instanceof and z.instanceof against globalThis.Temporal",
    (_label, raw) => {
      const { updated_at } = coerceRow({ updated_at: raw }, timestamptzTableInfo());

      expect(updated_at).toBeInstanceOf(globalThis.Temporal.Instant);
      expect(z.instanceof(globalThis.Temporal.Instant).safeParse(updated_at).success).toBe(true);
    },
  );
});
