import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { EntityTableMeta } from "../../db/entity-table-meta.js";
import { selectMany } from "../query.js";

const meta: EntityTableMeta = {
  source: "unmanaged",
  tableName: "probe_rows",
  indexes: [],
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "day", pgType: "date", notNull: false },
    { name: "at", pgType: "timestamptz", notNull: false },
    { name: "doc", pgType: "jsonb", notNull: false },
  ],
};

// Captures the params selectMany binds, so the write-side coercion of Temporal
// values is observable without a database.
async function boundParam(where: Record<string, unknown>): Promise<unknown> {
  let captured: readonly unknown[] = [];
  const db = {
    unsafe: async (_sql: string, params: readonly unknown[]) => {
      captured = params;
      return [];
    },
  };
  await selectMany(db, meta, where as never);
  return captured[0];
}

const instant = Temporal.Instant.from("2026-03-15T23:30:00Z");
const zoned = Temporal.ZonedDateTime.from("2026-03-15T23:30:00+00:00[UTC]");

describe("Temporal value binding", () => {
  test("date column: PlainDate, PlainDateTime, ZonedDateTime and Instant bind as yyyy-mm-dd", async () => {
    expect(await boundParam({ day: Temporal.PlainDate.from("2026-03-15") })).toBe("2026-03-15");
    expect(await boundParam({ day: Temporal.PlainDateTime.from("2026-03-15T23:30:00") })).toBe(
      "2026-03-15",
    );
    expect(await boundParam({ day: zoned })).toBe("2026-03-15");
    expect(await boundParam({ day: instant })).toBe("2026-03-15");
  });

  test("timestamptz column: Instant binds as ISO string", async () => {
    expect(await boundParam({ at: instant })).toBe("2026-03-15T23:30:00Z");
  });

  test("timestamptz column: ZonedDateTime is not coerced to an Instant string", async () => {
    expect(await boundParam({ at: zoned })).toBe(zoned);
  });

  test("jsonb column: an Instant is not bound as a structured jsonb object", async () => {
    expect(await boundParam({ doc: instant })).toBe(instant);
  });
});
