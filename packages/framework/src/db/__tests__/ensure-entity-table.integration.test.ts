import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";

import { asRawClient } from "../query.ts";
import { unsafeCreateEntityTable, unsafeEnsureEntityTable } from "../table-push.ts";

// unsafeEnsureEntityTable is the idempotent variant of unsafeCreateEntityTable —
// needed for the dev-server boot path, where the database persists and may contain
// a table from the previous run. unsafeCreateEntityTable remains strict so tests do
// not silently accept an incorrect schema.

const tenantEntity: EntityDefinition = {
  fields: {
    title: { type: "text", required: true },
  },
  table: "ensure_entity_table_probe",
} as unknown as EntityDefinition;

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.cleanup();
});

describe("unsafeEnsureEntityTable", () => {
  test("creates the table on the first call (returns true)", async () => {
    const created = await unsafeEnsureEntityTable(db.db, tenantEntity, "probe");
    expect(created).toBe(true);
    const rows = await asRawClient(db.db).unsafe<{ exists: boolean }>(
      `SELECT to_regclass('public.ensure_entity_table_probe') IS NOT NULL AS exists`,
    );
    expect(rows[0]?.exists).toBe(true);
  });

  test("is a no-op on the second call (returns false, no error)", async () => {
    const created = await unsafeEnsureEntityTable(db.db, tenantEntity, "probe");
    expect(created).toBe(false);
  });

  test("unsafeCreateEntityTable is idempotent — second push does not throw (CREATE IF NOT EXISTS)", async () => {
    // CREATE TABLE IF NOT EXISTS — idempotent by design.
    await expect(unsafeCreateEntityTable(db.db, tenantEntity, "probe")).resolves.toBeUndefined();
  });
});
