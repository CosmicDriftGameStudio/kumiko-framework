// Sanity test for the multi-row INSERT id-default behaviour.
//
// While building the publicstatus showcase, a multi-row INSERT into a
// join-table appeared to drop one row silently. The fix in the showcase
// was a per-row INSERT. This test pins down the actual behaviour at the
// framework layer so we know whether buildBaseColumns / Drizzle / PG
// have a real footgun, or whether the showcase bug had a different root
// cause.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildDrizzleTable } from "../../db/table-builder";
import { createEntity, createTextField } from "../../engine";
import { setupTestStack, type TestStack, unsafeCreateEntityTable } from "../../stack";
import { insertOne, selectMany } from "../../bun-db/query";

const linkEntity = createEntity({
  table: "mri_links",
  fields: {
    leftId: createTextField({ required: true }),
    rightId: createTextField({ required: true }),
  },
});
const linkTable = buildDrizzleTable("link", linkEntity);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  await unsafeCreateEntityTable(stack.db, linkEntity);
});

afterAll(async () => stack?.cleanup());

describe("instant() customType is forgiving with ISO strings", () => {
  // While building publicstatus we hit a footgun: Zod insert-schemas
  // validate timestamp fields as z.iso.datetime() (string), but the
  // instant() customType used to require Temporal.Instant on toDriver
  // and crashed obscurely otherwise. Coercion at the customType boundary
  // makes ISO-strings work without ceremony.

  const tsEntity = createEntity({
    table: "mri_ts",
    fields: { name: createTextField({ required: true }) },
  });
  const tsTable = buildDrizzleTable("ts-row", tsEntity);

  test("INSERT accepts an ISO string for an instant column (forgiving path)", async () => {
    await unsafeCreateEntityTable(stack.db, tsEntity, "ts-row");
    // insertedAt is base-column, type instant. Pass an ISO string —
    // coercion in toDriver handles it. Without the fix, Drizzle-driver
    // would call .toString() on a string and produce a malformed driver
    // value that PG rejects.
    const isoString = "2026-01-15T12:00:00Z";
    await insertOne(stack.db, tsTable, {
      name: "x",
      tenantId: "00000000-0000-4000-8000-000000000001",
      insertedAt: isoString as unknown as Temporal.Instant,
    });
    const rows = await selectMany(stack.db, tsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["insertedAt"]).toBeInstanceOf(Temporal.Instant);
  });
});

describe("multi-row INSERT", () => {
  test("two rows with no id supplied → both rows persist (PG gen_random_uuid per row)", async () => {
    await insertOne(stack.db, linkTable, [
      { leftId: "L1", rightId: "R1", tenantId: "00000000-0000-4000-8000-000000000001" },
      { leftId: "L2", rightId: "R2", tenantId: "00000000-0000-4000-8000-000000000001" },
    ]);
    const rows = await selectMany(stack.db, linkTable);
    expect(rows).toHaveLength(2);
    // Each row got its own id from the PG default.
    const ids = new Set(rows.map((r) => r["id"] as string));
    expect(ids.size).toBe(2);
  });
});
