// Generated RLS migration SQL applied to Postgres, and ON CONFLICT paths under the policies.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { SYSTEM_TENANT_ID } from "../../engine/types/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { renderRowLevelSecurityChanges } from "../migrate-rls-diff.ts";
import { readRowLevelSecurityState } from "../queries/rls-catalog.ts";
import { asRawClient } from "../query.ts";
import { tenantRowLevelSecurityFor } from "../render-rls-ddl.ts";
import { unsafePushTables } from "../table-push.ts";
import {
  asProbe,
  createProbeRole,
  grantProbeDml,
  INSUFFICIENT_PRIVILEGE,
  pgCodeOf,
} from "./rls-probe.ts";

function tenantTable(tableName: string) {
  return defineUnmanagedTable({
    tableName,
    columns: [
      { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
      { name: "tenant_id", pgType: "uuid", notNull: true },
      { name: "label", pgType: "text", notNull: false },
    ],
  });
}

const changesTable = tenantTable("store_rls_changes");
const conflictTable = tenantTable("store_rls_conflict");

const tenantA = testTenantId(211);
const tenantB = testTenantId(212);
const ID_A = "00000000-0000-4000-8000-0000000000a1";
const ID_B = "00000000-0000-4000-8000-0000000000b1";
const ID_SYSTEM = "00000000-0000-4000-8000-0000000000c1";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafePushTables(testDb.db, { changes: changesTable });
  await unsafePushTables(testDb.db, { conflict: conflictTable }, undefined, {
    rowLevelSecurity: "on",
  });
  await createProbeRole(testDb.db);
  await grantProbeDml(testDb.db, ["store_rls_conflict"]);
  const raw = asRawClient(testDb.db);
  for (const [id, tenant] of [
    [ID_A, tenantA],
    [ID_B, tenantB],
    [ID_SYSTEM, SYSTEM_TENANT_ID],
  ] as const) {
    await raw.unsafe(
      `INSERT INTO "store_rls_conflict" (id, tenant_id, label) VALUES ($1::uuid, $2::uuid, 'original')`,
      [id, tenant],
    );
  }
});

afterAll(async () => {
  await testDb.cleanup();
});

async function runSqlLines(lines: readonly string[]): Promise<void> {
  const raw = asRawClient(testDb.db);
  for (const line of lines.filter((l) => l !== "" && !l.startsWith("--"))) {
    await raw.unsafe(line);
  }
}

describe("generated row level security migration SQL", () => {
  test("enable then disable leave the catalog in the matching state", async () => {
    const spec = tenantRowLevelSecurityFor(changesTable);
    if (spec === undefined) throw new Error("fixture table must have a tenant_id column");

    await runSqlLines(
      renderRowLevelSecurityChanges([
        { kind: "enable", tableName: "store_rls_changes", next: spec },
      ]),
    );
    const enabled = await readRowLevelSecurityState(testDb.db, "public", "store_rls_changes");
    expect(enabled).toMatchObject({ enabled: true, forced: true });
    expect(enabled?.policies.map((p) => p.name)).toEqual([
      "kumiko_system_tenant_read",
      "kumiko_tenant_isolation",
    ]);

    await runSqlLines(
      renderRowLevelSecurityChanges([
        { kind: "disable", tableName: "store_rls_changes", previous: spec },
      ]),
    );
    expect(await readRowLevelSecurityState(testDb.db, "public", "store_rls_changes")).toEqual({
      enabled: false,
      forced: false,
      policies: [],
    });
  });
});

describe("INSERT ... ON CONFLICT under the policies", () => {
  const upsert = (id: string) =>
    `INSERT INTO "store_rls_conflict" (id, tenant_id, label) VALUES ($1::uuid, $2::uuid, 'hijacked')
     ON CONFLICT (id) DO UPDATE SET label = 'hijacked'`;

  async function labelOf(id: string): Promise<string | undefined> {
    const rows = await asRawClient(testDb.db).unsafe<{ label: string }>(
      `SELECT label FROM "store_rls_conflict" WHERE id = $1::uuid`,
      [id],
    );
    return rows[0]?.label;
  }

  test("DO UPDATE on a row of another tenant or of SYSTEM is rejected", async () => {
    const codes = await asProbe(testDb.db, { tenantId: tenantA }, async (raw) => ({
      foreign: await pgCodeOf(raw.unsafe(upsert(ID_B), [ID_B, tenantA])),
    }));
    expect(codes.foreign).toBe(INSUFFICIENT_PRIVILEGE);
    const systemCode = await asProbe(testDb.db, { tenantId: tenantA }, (raw) =>
      pgCodeOf(raw.unsafe(upsert(ID_SYSTEM), [ID_SYSTEM, tenantA])),
    );
    expect(systemCode).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await labelOf(ID_B)).toBe("original");
    expect(await labelOf(ID_SYSTEM)).toBe("original");
  });

  test("DO UPDATE on an own row works", async () => {
    const code = await asProbe(testDb.db, { tenantId: tenantA }, (raw) =>
      pgCodeOf(raw.unsafe(upsert(ID_A), [ID_A, tenantA])),
    );
    expect(code).toBeUndefined();
  });

  test("DO NOTHING against a row of another tenant inserts nothing and leaves it unchanged", async () => {
    const inserted = await asProbe(testDb.db, { tenantId: tenantA }, (raw) =>
      raw.unsafe(
        `INSERT INTO "store_rls_conflict" (id, tenant_id, label) VALUES ($1::uuid, $2::uuid, 'hijacked')
         ON CONFLICT DO NOTHING RETURNING id`,
        [ID_B, tenantA],
      ),
    );
    expect(inserted).toHaveLength(0);
    expect(await labelOf(ID_B)).toBe("original");
  });
});
