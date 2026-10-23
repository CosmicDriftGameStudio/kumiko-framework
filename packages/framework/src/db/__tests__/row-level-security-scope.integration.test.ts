// Ambient row-level-security scope against real Postgres, connected as a non-bypass application role.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { SYSTEM_TENANT_ID, type TenantId } from "../../engine/types/index.ts";
import { AccessDeniedError } from "../../errors/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import type { DbRunner } from "../connection.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { hasExecutorManagedWriteCapability } from "../executor-managed-tables.ts";
import { applyTableRowLevelSecurity } from "../queries/ddl.ts";
import { readRowLevelSecurityState } from "../queries/rls-catalog.ts";
import { asRawClient, runInSavepoint, transaction } from "../query.ts";
import { rowLevelSecurityModeOf } from "../row-level-security-connection.ts";
import {
  runInRowLevelSecurityScope,
  runInSystemRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
  withRowLevelSecurityScope,
} from "../row-level-security-scope.ts";
import { unsafePushTables } from "../table-push.ts";
import { createTenantDb } from "../tenant-db.ts";
import { INSUFFICIENT_PRIVILEGE, pgCodeOf } from "./rls-probe.ts";

const itemsTable = defineUnmanagedTable({
  tableName: "store_rls_scope_items",
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

// Unmanaged global tables carry no tenant_id of their own; entity-derived ones do, so it is added below.
const globalTable = defineUnmanagedTable({
  tableName: "store_rls_scope_global",
  tenancy: "global",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "label", pgType: "text", notNull: true },
  ],
});

const tenantA = testTenantId(311);
const tenantB = testTenantId(312);
const SELECT_LABELS = `SELECT label FROM "store_rls_scope_items" ORDER BY label`;

let testDb: TestDb;
let plainDb: TestDb;

async function labelsOf(runner: unknown): Promise<string[]> {
  const rows = await asRawClient(runner).unsafe<{ label: string }>(SELECT_LABELS);
  return rows.map((row) => row.label);
}

const asTenant = <T>(tenantId: TenantId, fn: () => T): T =>
  runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantId), fn);

const labelOf = (tenantId: string) => `seed-${tenantId}`;

beforeAll(async () => {
  testDb = await createTestDb({ applicationRole: true });
  plainDb = await createTestDb();
  await unsafePushTables(testDb.db, { items: itemsTable, globalItems: globalTable });
  await asRawClient(testDb.db).unsafe(
    `ALTER TABLE "store_rls_scope_global" ADD COLUMN tenant_id uuid NOT NULL DEFAULT '${SYSTEM_TENANT_ID}'`,
  );
  await applyTableRowLevelSecurity(testDb.db, {
    ...globalTable,
    columns: [...globalTable.columns, { name: "tenant_id", pgType: "uuid", notNull: true }],
  });
  await runInSystemRowLevelSecurityScope(async () => {
    for (const tenant of [tenantA, tenantB, SYSTEM_TENANT_ID]) {
      await asRawClient(testDb.db).unsafe(
        `INSERT INTO "store_rls_scope_items" (tenant_id, label) VALUES ($1::uuid, $2)`,
        [tenant, labelOf(tenant)],
      );
    }
  });
});

afterAll(async () => {
  await testDb.cleanup();
  await plainDb.cleanup();
});

describe("pool statements", () => {
  test("policies exist on the pushed table", async () => {
    const state = await readRowLevelSecurityState(testDb.db, "public", "store_rls_scope_items");
    expect(state?.forced).toBe(true);
    expect(state?.policies.map((policy) => policy.name)).toEqual([
      "kumiko_system_tenant_read",
      "kumiko_tenant_isolation",
    ]);
  });

  test("without a scope nothing is visible", async () => {
    expect(await labelsOf(testDb.db)).toEqual([]);
  });

  test("a tenant scope sees its own rows plus system rows, a system scope sees all", async () => {
    expect(await asTenant(tenantA, () => labelsOf(testDb.db))).toEqual(
      [labelOf(tenantA), labelOf(SYSTEM_TENANT_ID)].sort(),
    );
    expect(await runInSystemRowLevelSecurityScope(() => labelsOf(testDb.db))).toHaveLength(3);
  });
});

describe("transactions", () => {
  test("a released savepoint with a system read does not leak into the next tenant read", async () => {
    await asTenant(tenantA, () =>
      transaction(testDb.db, async (tx) => {
        expect(await labelsOf(tx)).toHaveLength(2);
        await runInSavepoint(tx, async (sp) => {
          const all = await runInSystemRowLevelSecurityScope(() => labelsOf(sp));
          expect(all).toHaveLength(3);
        });
        expect(await labelsOf(tx)).not.toContain(labelOf(tenantB));
      }),
    );
  });

  test("a rolled-back savepoint does not leak either", async () => {
    await asTenant(tenantA, () =>
      transaction(testDb.db, async (tx) => {
        await labelsOf(tx);
        await runInSavepoint(tx, async (sp) => {
          await runInSystemRowLevelSecurityScope(() => labelsOf(sp));
          throw new Error("roll back the savepoint");
        }).catch(() => undefined);
        expect(await labelsOf(tx)).not.toContain(labelOf(tenantB));
      }),
    );
  });

  test("concurrent statements on one tx each see their own scope", async () => {
    await transaction(testDb.db, async (tx) => {
      const [first, all, second] = await Promise.all([
        asTenant(tenantA, () => labelsOf(tx)),
        runInSystemRowLevelSecurityScope(() => labelsOf(tx)),
        asTenant(tenantB, () => labelsOf(tx)),
      ]);
      expect(first).toEqual([labelOf(tenantA), labelOf(SYSTEM_TENANT_ID)].sort());
      expect(all).toHaveLength(3);
      expect(second).toEqual([labelOf(tenantB), labelOf(SYSTEM_TENANT_ID)].sort());
    });
  });

  test("a tenant insert after a system statement cannot write another tenant's row", async () => {
    const attempt = transaction(testDb.db, async (tx) => {
      await runInSystemRowLevelSecurityScope(() => labelsOf(tx));
      await asTenant(tenantA, () =>
        asRawClient(tx).unsafe(
          `INSERT INTO "store_rls_scope_items" (tenant_id, label) VALUES ($1::uuid, 'forged')`,
          [tenantB],
        ),
      );
    });
    expect(await pgCodeOf(attempt)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("a statement without a scope after a tenant statement sees nothing", async () => {
    await transaction(testDb.db, async (tx) => {
      expect(await asTenant(tenantA, () => labelsOf(tx))).toHaveLength(2);
      expect(await labelsOf(tx)).toEqual([]);
    });
  });
});

describe("TenantDb", () => {
  const labels = async (db: ReturnType<typeof createTenantDb>) =>
    (await db.selectMany<{ label: string }>(itemsTable)).map((row) => row.label).sort();

  test("tenant mode reads its own rows plus system rows even inside a system scope", async () => {
    const tenantDb = createTenantDb({ db: testDb.db, tenantId: tenantA, mode: "tenant" });
    const expected = [labelOf(tenantA), labelOf(SYSTEM_TENANT_ID)].sort();
    expect(await labels(tenantDb)).toEqual(expected);
    expect(await runInSystemRowLevelSecurityScope(() => labels(tenantDb))).toEqual(expected);
  });

  test("system mode sees every tenant", async () => {
    const systemDb = createTenantDb({ db: testDb.db, tenantId: tenantA, mode: "system" });
    expect(await labels(systemDb)).toHaveLength(3);
  });

  test("a granted unsafeRaw runner sees every tenant, the audited raw escape for cross-tenant handlers", async () => {
    const tenantDb = createTenantDb({
      db: testDb.db,
      tenantId: tenantA,
      mode: "tenant",
      grants: { unsafeRaw: { reason: "scope test" } },
    });
    expect(await labelsOf(tenantDb.unsafeRaw())).toHaveLength(3);
  });

  test("createTenantDb over an unsafeRaw runner inherits the personal-data gate and no executor capability", async () => {
    const denied: string[] = [];
    const tenantDb = createTenantDb({
      db: testDb.db,
      tenantId: tenantA,
      mode: "tenant",
      grants: {
        unsafeRaw: { reason: "scope test" },
        personalDataGate: (tableName) => {
          denied.push(tableName);
          throw new AccessDeniedError({ message: "personal data denied" });
        },
      },
    });
    const runner: DbRunner = tenantDb.unsafeRaw();
    expect(hasExecutorManagedWriteCapability(runner)).toBe(false);
    const inner = createTenantDb({ db: runner, tenantId: tenantA, mode: "tenant" });
    await expect(inner.insertOne(itemsTable, { label: "blocked" })).rejects.toThrow(
      AccessDeniedError,
    );
    expect(denied).toContain("store_rls_scope_items");
  });
});

describe("db.global()", () => {
  test("a tenant-mode write on a global table succeeds under row level security", async () => {
    const tenantDb = createTenantDb({
      db: testDb.db,
      tenantId: tenantA,
      mode: "tenant",
      grants: { globalWrites: { reason: "scope test" } },
    });
    const inserted = await tenantDb
      .global(globalTable)
      .insertOne<{ label: string }>({ label: "global-row" });
    expect(inserted?.label).toBe("global-row");
  });
});

describe("rowLevelSecurityModeOf", () => {
  test("is on for the enforced pool, its tx handles and scope wrappers", async () => {
    expect(rowLevelSecurityModeOf(testDb.db)).toBe("on");
    expect(rowLevelSecurityModeOf(withRowLevelSecurityScope(testDb.db, { kind: "system" }))).toBe(
      "on",
    );
    await transaction(testDb.db, async (tx) => {
      expect(rowLevelSecurityModeOf(tx)).toBe("on");
    });
  });

  test("is off for a plain test pool", () => {
    expect(rowLevelSecurityModeOf(plainDb.db)).toBe("off");
  });
});
