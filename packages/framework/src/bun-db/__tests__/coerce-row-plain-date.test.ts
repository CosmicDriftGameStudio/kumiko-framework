// kumiko-framework#1924: `type:"date"` used to alias onto instant()
// (TIMESTAMPTZ) and round-trip through Temporal.Instant, making the
// read value depend on the process/session timezone. This test pins the
// fixed coercion: a `date` pgType column reads back as Temporal.PlainDate,
// and — the part that actually matters — the calendar day survives a
// non-UTC process TZ, because Bun.SQL hands back a Date anchored at UTC
// midnight and the coercion must read it via that anchor, not local getters.

import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { coerceRow, type TableInfo } from "../query";

function dateTableInfo(): TableInfo {
  return {
    name: "probe",
    columnOf: (f) => f,
    pgTypeOf: (c) => (c === "published_at" ? "date" : undefined),
    bigintJsModeOf: () => undefined,
    fieldOf: (c) => c,
    hasColumn: () => true,
  };
}

describe("coerceRow — date → Temporal.PlainDate", () => {
  test("coerces a driver Date (UTC-midnight anchored) to the same calendar day", () => {
    // Simulates the Bun.SQL wire value for `SELECT '2026-03-15'::date` —
    // verified empirically to be a JS Date at epoch 1773532800000
    // (2026-03-15T00:00:00.000Z) regardless of process TZ.
    const row = { published_at: new Date(Date.UTC(2026, 2, 15)) };
    const result = coerceRow(row, dateTableInfo());
    expect(result.published_at).toBeInstanceOf(Temporal.PlainDate);
    expect((result.published_at as unknown as Temporal.PlainDate).toString()).toBe("2026-03-15");
  });

  test("does not drift the day under a negative-offset process TZ", () => {
    // Regression guard for the exact bug shape: naive `new
    // Date(...).getDate()` reads the 14th under America/Los_Angeles for a
    // UTC-midnight-anchored 15th. plainDateFromDriver must not do that.
    const savedTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const row = { published_at: new Date(Date.UTC(2026, 2, 15)) };
      const result = coerceRow(row, dateTableInfo());
      expect((result.published_at as unknown as Temporal.PlainDate).toString()).toBe("2026-03-15");
    } finally {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    }
  });

  test("coerces a plain 'yyyy-mm-dd' driver string", () => {
    const row = { published_at: "2026-12-01" };
    const result = coerceRow(row, dateTableInfo());
    expect(result.published_at).toBeInstanceOf(Temporal.PlainDate);
    expect((result.published_at as unknown as Temporal.PlainDate).toString()).toBe("2026-12-01");
  });

  test("passes an already-PlainDate value through unchanged", () => {
    const pd = Temporal.PlainDate.from("2026-01-01");
    const row = { published_at: pd };
    const result = coerceRow(row, dateTableInfo());
    expect(result.published_at).toBe(pd);
  });

  test("leaves null untouched", () => {
    const row = { published_at: null };
    const result = coerceRow(row, dateTableInfo());
    expect(result.published_at).toBeNull();
  });
});
