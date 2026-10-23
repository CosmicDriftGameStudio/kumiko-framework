// Parallel savepoints on an enforced transaction: no 3B001 and no hang, whichever proxy they come through.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { testTenantId } from "../../seeding/seed-users.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { asRawClient, runInSavepoint, transaction } from "../query.ts";
import {
  runInRowLevelSecurityScope,
  runInSystemRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
  withRowLevelSecurityScope,
} from "../row-level-security-scope.ts";
import { unsafePushTables } from "../table-push.ts";

const itemsTable = defineUnmanagedTable({
  tableName: "store_rls_parallel_sp",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "label", pgType: "text", notNull: false },
  ],
});

const tenant = testTenantId(331);
const scope = tenantRowLevelSecurityScope(tenant);

let testDb: TestDb;

async function insertAfterPause(runner: unknown, label: string, pauseSeconds: number) {
  const raw = asRawClient(runner);
  await raw.unsafe("SELECT pg_sleep($1)", [pauseSeconds]);
  await raw.unsafe(`INSERT INTO "store_rls_parallel_sp" (tenant_id, label) VALUES ($1::uuid, $2)`, [
    tenant,
    label,
  ]);
}

async function committedLabels(): Promise<string[]> {
  return runInSystemRowLevelSecurityScope(async () => {
    const rows = await asRawClient(testDb.db).unsafe<{ label: string }>(
      `SELECT label FROM "store_rls_parallel_sp" ORDER BY label`,
    );
    return rows.map((row) => row.label);
  });
}

beforeAll(async () => {
  testDb = await createTestDb({ applicationRole: true });
  await unsafePushTables(testDb.db, { items: itemsTable });
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("parallel savepoints on an enforced transaction", () => {
  test("savepoints reached through the tx handle and a scoped runner of it are serialized", async () => {
    await runInRowLevelSecurityScope(scope, () =>
      transaction(testDb.db, async (tx) => {
        const scopedTx = withRowLevelSecurityScope(tx, scope);
        await Promise.all([
          runInSavepoint(tx, (sp) => insertAfterPause(sp, "a-tx", 0.06)),
          runInSavepoint(scopedTx, (sp) => insertAfterPause(sp, "b-scoped", 0.03)),
          runInSavepoint(tx, (sp) => insertAfterPause(sp, "c-tx", 0)),
          runInSavepoint(scopedTx, (sp) => insertAfterPause(sp, "d-scoped", 0)),
        ]);
      }),
    );

    expect(await committedLabels()).toEqual(["a-tx", "b-scoped", "c-tx", "d-scoped"]);
  });

  test("a savepoint nested in a running one does not wait for it", async () => {
    await runInRowLevelSecurityScope(scope, () =>
      transaction(testDb.db, async (tx) => {
        await Promise.all([
          runInSavepoint(tx, async (outer) => {
            await insertAfterPause(outer, "e-outer", 0.02);
            await runInSavepoint(outer, (inner) => insertAfterPause(inner, "f-inner", 0));
          }),
          runInSavepoint(withRowLevelSecurityScope(tx, scope), (sp) =>
            insertAfterPause(sp, "g-sibling", 0),
          ),
        ]);
      }),
    );

    expect(await committedLabels()).toEqual([
      "a-tx",
      "b-scoped",
      "c-tx",
      "d-scoped",
      "e-outer",
      "f-inner",
      "g-sibling",
    ]);
  });
});
