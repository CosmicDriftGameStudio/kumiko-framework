// ctx.db.unsafeRaw() runs in its TenantDb's own row-level-security scope; unsafeRawAllTenants() in the system scope.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { SYSTEM_TENANT_ID } from "../../engine/types/index.ts";
import { AccessDeniedError } from "../../errors/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { asRawClient, transaction } from "../query.ts";
import { runInSystemRowLevelSecurityScope } from "../row-level-security-scope.ts";
import { unsafePushTables } from "../table-push.ts";
import { createTenantDb } from "../tenant-db.ts";
import { INSUFFICIENT_PRIVILEGE, pgCodeOf } from "./rls-probe.ts";

const itemsTable = defineUnmanagedTable({
  tableName: "store_unsafe_raw_scope_items",
  systemRowsReadable: true,
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
const SELECT_LABELS = `SELECT label FROM "store_unsafe_raw_scope_items" ORDER BY label`;
const grants = { unsafeRaw: { reason: "unsafe raw scope test" } };

let testDb: TestDb;

async function labelsOf(runner: unknown): Promise<string[]> {
  const rows = await asRawClient(runner).unsafe<{ label: string }>(SELECT_LABELS);
  return rows.map((row) => row.label);
}

const labelOf = (tenantId: string) => `seed-${tenantId}`;

beforeAll(async () => {
  testDb = await createTestDb({ applicationRole: true });
  await unsafePushTables(testDb.db, { items: itemsTable });
  await runInSystemRowLevelSecurityScope("test seeds rows for several tenants", async () => {
    for (const tenant of [tenantA, tenantB, SYSTEM_TENANT_ID]) {
      await asRawClient(testDb.db).unsafe(
        `INSERT INTO "store_unsafe_raw_scope_items" (tenant_id, label) VALUES ($1::uuid, $2)`,
        [tenant, labelOf(tenant)],
      );
    }
  });
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("ctx.db.unsafeRaw scope", () => {
  test("unsafeRaw() of a tenant-mode db sees its own rows plus system rows", async () => {
    const tenantDb = createTenantDb({ db: testDb.db, tenantId: tenantA, mode: "tenant", grants });

    expect(await labelsOf(tenantDb.unsafeRaw())).toEqual(
      [labelOf(tenantA), labelOf(SYSTEM_TENANT_ID)].sort(),
    );
  });

  test("unsafeRaw() cannot insert a row for another tenant", async () => {
    const tenantDb = createTenantDb({ db: testDb.db, tenantId: tenantA, mode: "tenant", grants });

    const attempt = asRawClient(tenantDb.unsafeRaw()).unsafe(
      `INSERT INTO "store_unsafe_raw_scope_items" (tenant_id, label) VALUES ($1::uuid, 'x')`,
      [tenantB],
    );

    expect(await pgCodeOf(attempt)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("unsafeRaw() inside a transaction keeps the tenant scope", async () => {
    const labels = await transaction(testDb.db, async (tx) =>
      labelsOf(createTenantDb({ db: tx, tenantId: tenantA, mode: "tenant", grants }).unsafeRaw()),
    );

    expect(labels).toEqual([labelOf(tenantA), labelOf(SYSTEM_TENANT_ID)].sort());
  });

  test("unsafeRawAllTenants() sees every tenant", async () => {
    const tenantDb = createTenantDb({ db: testDb.db, tenantId: tenantA, mode: "tenant", grants });

    expect(await labelsOf(tenantDb.unsafeRawAllTenants())).toHaveLength(3);
  });

  test("unsafeRaw() of a system-mode db sees every tenant", async () => {
    const systemDb = createTenantDb({
      db: testDb.db,
      tenantId: tenantA,
      mode: "system",
      reason: "test proves system mode keeps the system scope on unsafeRaw",
      grants,
    });

    expect(await labelsOf(systemDb.unsafeRaw())).toHaveLength(3);
  });

  test("without the grant both raw runners are rejected", () => {
    const tenantDb = createTenantDb({ db: testDb.db, tenantId: tenantA, mode: "tenant" });

    expect(() => tenantDb.unsafeRaw()).toThrow(AccessDeniedError);
    expect(() => tenantDb.unsafeRawAllTenants()).toThrow(AccessDeniedError);
  });
});
