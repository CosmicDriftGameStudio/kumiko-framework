// The enforced pool pipelines BEGIN, set_config, the statement and COMMIT on one reserved
// connection. Real Postgres as the non-bypass application role; max-1 pools make every
// statement reuse the same connection, so a leaked scope or open transaction shows up.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import type { TenantId } from "../../engine/types/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { applyTableRowLevelSecurity } from "../queries/ddl.ts";
import { asRawClient } from "../query.ts";
import {
  runInRowLevelSecurityScope,
  runInSystemRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "../row-level-security-scope.ts";
import { unsafePushTables } from "../table-push.ts";
import { INSUFFICIENT_PRIVILEGE, pgCodeOf } from "./rls-probe.ts";

const table = defineUnmanagedTable({
  tableName: "store_rls_pipelined_items",
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

const tenantA = testTenantId(321);
const tenantB = testTenantId(322);
const SELECT_LABELS = `SELECT label FROM "store_rls_pipelined_items" ORDER BY label`;
const SESSION_STATE = `SELECT coalesce(current_setting('kumiko.tenant_id', true), '') AS tenant,
  coalesce(current_setting('kumiko.scope', true), '') AS scope,
  now() <> statement_timestamp() AS in_open_transaction`;
const labelOf = (tenantId: string) => `seed-${tenantId}`;

let singleDb: TestDb;
let pairDb: TestDb;

const asTenant = <T>(tenantId: TenantId, fn: () => T): T =>
  runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantId), fn);

async function labelsOf(db: TestDb): Promise<string[]> {
  const rows = await asRawClient(db.db).unsafe<{ label: string }>(SELECT_LABELS);
  return rows.map((row) => row.label);
}

async function sessionState(db: TestDb) {
  const rows = await asRawClient(db.db).unsafe<{
    tenant: string;
    scope: string;
    in_open_transaction: boolean;
  }>(SESSION_STATE);
  return rows[0];
}

beforeAll(async () => {
  singleDb = await createTestDb({ applicationRole: true, poolMax: 1 });
  await unsafePushTables(singleDb.db, { items: table });
  await applyTableRowLevelSecurity(singleDb.db, table);
  await runInSystemRowLevelSecurityScope("test seeds rows for several tenants", async () => {
    for (const tenant of [tenantA, tenantB]) {
      await asRawClient(singleDb.db).unsafe(
        `INSERT INTO "store_rls_pipelined_items" (tenant_id, label) VALUES ($1::uuid, $2)`,
        [tenant, labelOf(tenant)],
      );
    }
  });
  // A second pool on the same database, with two connections for the concurrency case.
  pairDb = await createTestDb({
    applicationRole: true,
    poolMax: 2,
    dbName: singleDb.dbName,
    persistent: true,
  });
});

afterAll(async () => {
  await pairDb.cleanup();
  await singleDb.cleanup();
});

describe("pipelined pool statements", () => {
  test("tenant scope sees its own rows, system scope sees all, no scope sees none", async () => {
    expect(await asTenant(tenantA, () => labelsOf(singleDb))).toEqual([labelOf(tenantA)]);
    expect(
      await runInSystemRowLevelSecurityScope("test reads all tenants", () => labelsOf(singleDb)),
    ).toEqual([labelOf(tenantA), labelOf(tenantB)].sort());
    expect(await labelsOf(singleDb)).toEqual([]);
  });

  test("a failing statement leaves no scope and no open transaction on the connection", async () => {
    await expect(
      asTenant(tenantA, () => asRawClient(singleDb.db).unsafe(`SELECT 1/0`)),
    ).rejects.toThrow();
    const afterDivision = await sessionState(singleDb);
    expect(afterDivision).toEqual({ tenant: "", scope: "", in_open_transaction: false });

    const foreignInsert = asTenant(tenantA, async () =>
      asRawClient(singleDb.db).unsafe(
        `INSERT INTO "store_rls_pipelined_items" (tenant_id, label) VALUES ($1::uuid, 'x')`,
        [tenantB],
      ),
    );
    expect(await pgCodeOf(foreignInsert)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await sessionState(singleDb)).toEqual({
      tenant: "",
      scope: "",
      in_open_transaction: false,
    });
    expect(await labelsOf(singleDb)).toEqual([]);
  });

  test("a successful statement does not leave its scope behind either", async () => {
    await asTenant(tenantA, () => labelsOf(singleDb));
    expect(await sessionState(singleDb)).toEqual({
      tenant: "",
      scope: "",
      in_open_transaction: false,
    });
  });

  test("50 concurrent scoped reads of two tenants on two connections never cross", async () => {
    const reads = Array.from({ length: 50 }, (_, i) => {
      const own = i % 2 === 0 ? tenantA : tenantB;
      const other = own === tenantA ? tenantB : tenantA;
      return asTenant(own, () => labelsOf(pairDb)).then((labels) => {
        expect(labels).toEqual([labelOf(own)]);
        expect(labels).not.toContain(labelOf(other));
      });
    });
    await Promise.all(reads);
  });
});
