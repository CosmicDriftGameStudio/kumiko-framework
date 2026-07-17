// Prod-relevant bug: NumberFieldDef mapped unconditionally to a Postgres
// `integer` column regardless of the `integer` flag. `createNumberField()`
// (no `integer: true`) accepts fractional values at the Zod boundary but
// the column rejected them at the DB with "invalid input syntax for type
// integer" — Monte-Carlo-style stats fields (phronexsis simulation results)
// hit this on every non-integer result. Fix: `integer: true` → `integer`
// column, otherwise → `double precision` (fractional values round-trip).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createNumberField } from "../../engine";
import { setupTestStack, type TestStack, unsafeCreateEntityTable } from "../../stack";

const statsEntity = createEntity({
  table: "nff_stats",
  fields: {
    expectedValue: createNumberField({ sortable: true }),
    wholeCount: createNumberField({ integer: true }),
  },
});
const statsTable = buildEntityTable("nff-stats", statsEntity);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  await unsafeCreateEntityTable(stack.db, statsEntity, "nff-stats");
});

afterAll(async () => stack?.cleanup());

describe("createNumberField() without integer:true — fractional values round-trip", () => {
  test("INSERT accepts a non-integer value and SELECT returns it unchanged", async () => {
    await seedRow(stack.db, statsTable, {
      expectedValue: 77.02269129478736,
      wholeCount: 3,
      tenantId: "00000000-0000-4000-8000-000000000001",
    });
    const rows = await selectMany(stack.db, statsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["expectedValue"]).toBe(77.02269129478736);
    expect(rows[0]?.["wholeCount"]).toBe(3);
  });
});

describe("createNumberField({ integer: true }) — still rejects fractional values at the DB", () => {
  test("INSERT with a non-integer value into an integer-flagged field throws", async () => {
    await expect(
      seedRow(stack.db, statsTable, {
        expectedValue: 1,
        wholeCount: 3.5 as unknown as number,
        tenantId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow(/invalid input syntax for type integer/);
  });
});
