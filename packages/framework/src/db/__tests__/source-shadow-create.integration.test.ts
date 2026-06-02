// End-to-end regression for the EntityTableMeta discriminator shadow.
//
// An entity field literally named `source` overwrote the `source:
// "managed"|"unmanaged"` discriminator on the table-meta. extractTableInfo
// then failed its meta check, fell into the dead drizzle branch, and typed the
// timestamptz base-columns as "timestamp with time zone" (getSQLType spelling).
// prepareValue only serializes Temporal.Instant for "timestamptz", so a raw
// Temporal reached postgres-js → "Cannot use valueOf" on every create.
//
// extract-table-info.test.ts pins the proximate cause (pgTypeOf stays
// "timestamptz"). This proves the actual create-path no longer crashes — the
// integration proof the unit test cannot give.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertOne, selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createTextField } from "../../engine";
import { setupTestStack, type TestStack, unsafeCreateEntityTable } from "../../stack";

const sourceEntity = createEntity({
  table: "ssc_source",
  fields: {
    // `source` collides with the EntityTableMeta discriminator key.
    source: createTextField({ required: true }),
  },
});
const sourceTable = buildEntityTable("source-row", sourceEntity);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  await unsafeCreateEntityTable(stack.db, sourceEntity, "source-row");
});

afterAll(async () => stack?.cleanup());

describe("entity with a `source` field — create-path is shadow-proof", () => {
  test("insertOne serializes the timestamptz inserted_at — no Temporal valueOf crash", async () => {
    // Passing a real Temporal.Instant exercises the timestamptz serializer
    // path that the shadow used to bypass. Pre-fix this threw "Cannot use
    // valueOf"; post-fix the row persists and round-trips as a Temporal.Instant.
    await insertOne(stack.db, sourceTable, {
      source: "import",
      tenantId: "00000000-0000-4000-8000-000000000001",
      insertedAt: Temporal.Instant.from("2026-01-15T12:00:00Z"),
    });

    const rows = await selectMany(stack.db, sourceTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["source"]).toBe("import");
    expect(rows[0]?.["insertedAt"]).toBeInstanceOf(Temporal.Instant);
  });
});
