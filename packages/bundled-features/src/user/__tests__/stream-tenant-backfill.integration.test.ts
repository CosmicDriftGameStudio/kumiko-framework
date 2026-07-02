// #762 — backfillUserStreamTenants: pre-#497 user streams live on the
// creating tenant; post-#497 the executor addresses SYSTEM_TENANT_ID, so
// legacy users version-conflict on every write (password-reset collapses to
// invalid_token). The backfill retenants + renumbers per aggregate in global
// id order — including the split-stream case the raw #497-changeset SQL
// crashes on (legacy tenant v1..n AND post-#497 SYSTEM events for the same
// aggregate → events_aggregate_version_uq violation).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { append, createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { backfillUserStreamTenants } from "../db/queries/stream-tenant-backfill";
import { userEntity, userTable } from "../schema/user";

const T1 = "00000000-0000-4000-8000-000000000011" as TenantId;
const LEGACY_USER = "aaaaaaaa-0000-4000-8000-000000000001";
const SPLIT_USER = "aaaaaaaa-0000-4000-8000-000000000002";
const MODERN_USER = "aaaaaaaa-0000-4000-8000-000000000003";

let testDb: TestDb;

const executor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userEntity, "user");
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, kumiko_snapshots, kumiko_archived_streams, read_users RESTART IDENTITY CASCADE`,
  );
});

async function appendUserEvent(
  aggregateId: string,
  tenantId: TenantId,
  expectedVersion: number,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await append(testDb.db, {
    aggregateId,
    aggregateType: "user",
    tenantId,
    expectedVersion,
    type,
    payload,
    metadata: { userId: "test-migrator" },
  });
}

async function streamRows(
  aggregateId: string,
): Promise<ReadonlyArray<{ tenant_id: string; version: number; type: string }>> {
  return (await asRawClient(testDb.db).unsafe(
    `SELECT "tenant_id", "version", "type" FROM "kumiko_events"
      WHERE "aggregate_id" = $1::uuid ORDER BY "id" ASC`,
    [aggregateId],
  )) as ReadonlyArray<{ tenant_id: string; version: number; type: string }>;
}

function seedUserRow(id: string, tenantId: TenantId, version: number) {
  return asRawClient(testDb.db).unsafe(
    `INSERT INTO "read_users" ("id", "tenant_id", "email", "display_name", "locale", "password_hash", "status", "version")
     VALUES ($1::uuid, $2::uuid, $3, 'Legacy', 'de', 'x', 'active', $4)`,
    [id, tenantId, `${id.slice(0, 8)}@example.com`, version],
  );
}

describe("backfillUserStreamTenants (#762)", () => {
  test("legacy stream: retenanted to SYSTEM, versions contiguous, executor write works again", async () => {
    await appendUserEvent(LEGACY_USER, T1, 0, "user.created", { email: "l@example.com" });
    await appendUserEvent(LEGACY_USER, T1, 1, "user.updated", { changes: { displayName: "L" } });
    await seedUserRow(LEGACY_USER, T1, 2);

    const result = await backfillUserStreamTenants(testDb.db);
    expect(result.aggregatesMigrated).toBe(1);
    expect(result.eventsMigrated).toBe(2);
    expect(result.failed).toHaveLength(0);

    const rows = await streamRows(LEGACY_USER);
    expect(rows.map((r) => r.tenant_id)).toEqual([SYSTEM_TENANT_ID, SYSTEM_TENANT_ID]);
    expect(rows.map((r) => r.version)).toEqual([1, 2]);

    // The actual #762 symptom: an optimistic-locked executor update with the
    // row version now targets a stream that HAS that version — no conflict.
    const tdb = createTenantDb(testDb.db, SYSTEM_TENANT_ID, "system");
    const writeRes = await executor.update(
      { id: LEGACY_USER, version: 2, changes: { displayName: "After" } },
      createSystemUser(SYSTEM_TENANT_ID),
      tdb,
    );
    expect(writeRes.isSuccess).toBe(true);
  });

  test("split stream (legacy + post-#497 SYSTEM events) merges in global id order", async () => {
    // Legacy: created + updated on T1 (v1, v2). Then a post-#497 lifecycle
    // write appended v1 on SYSTEM — the split the raw changeset-SQL trips on.
    await appendUserEvent(SPLIT_USER, T1, 0, "user.created", { email: "s@example.com" });
    await appendUserEvent(SPLIT_USER, T1, 1, "user.updated", { changes: { a: 1 } });
    await appendUserEvent(SPLIT_USER, SYSTEM_TENANT_ID, 0, "user.updated", {
      changes: { status: "restricted" },
    });
    await seedUserRow(SPLIT_USER, T1, 2);

    const result = await backfillUserStreamTenants(testDb.db);
    expect(result.aggregatesMigrated).toBe(1);
    expect(result.eventsMigrated).toBe(3);
    expect(result.failed).toHaveLength(0);

    const rows = await streamRows(SPLIT_USER);
    expect(rows.map((r) => r.tenant_id)).toEqual([
      SYSTEM_TENANT_ID,
      SYSTEM_TENANT_ID,
      SYSTEM_TENANT_ID,
    ]);
    // Renumbered by global event id: created, updated(T1), updated(SYSTEM).
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(rows[0]?.type).toBe("user.created");
  });

  test("idempotent: second run finds nothing; modern SYSTEM streams untouched", async () => {
    await appendUserEvent(MODERN_USER, SYSTEM_TENANT_ID, 0, "user.created", {
      email: "m@example.com",
    });
    await appendUserEvent(LEGACY_USER, T1, 0, "user.created", { email: "l@example.com" });

    const first = await backfillUserStreamTenants(testDb.db);
    expect(first.aggregatesMigrated).toBe(1);

    const second = await backfillUserStreamTenants(testDb.db);
    expect(second.aggregatesMigrated).toBe(0);
    expect(second.eventsMigrated).toBe(0);

    const modern = await streamRows(MODERN_USER);
    expect(modern).toHaveLength(1);
    expect(modern[0]?.version).toBe(1);
  });

  test("stale snapshots dropped, archived-stream marker moves to SYSTEM", async () => {
    await appendUserEvent(LEGACY_USER, T1, 0, "user.created", { email: "l@example.com" });
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "kumiko_snapshots" ("aggregate_id", "aggregate_type", "tenant_id", "version", "state")
       VALUES ($1::uuid, 'user', $2::uuid, 1, '{}'::jsonb)`,
      [LEGACY_USER, T1],
    );
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "kumiko_archived_streams" ("tenant_id", "aggregate_id", "aggregate_type", "archived_by")
       VALUES ($1::uuid, $2::uuid, 'user', 'test')`,
      [T1, LEGACY_USER],
    );

    const result = await backfillUserStreamTenants(testDb.db);
    expect(result.failed).toHaveLength(0);

    const snapshots = (await asRawClient(testDb.db).unsafe(
      `SELECT count(*)::int AS n FROM "kumiko_snapshots" WHERE "aggregate_id" = $1::uuid`,
      [LEGACY_USER],
    )) as ReadonlyArray<{ n: number }>;
    expect(snapshots[0]?.n).toBe(0);

    const archived = (await asRawClient(testDb.db).unsafe(
      `SELECT "tenant_id" FROM "kumiko_archived_streams" WHERE "aggregate_id" = $1::uuid`,
      [LEGACY_USER],
    )) as ReadonlyArray<{ tenant_id: string }>;
    expect(archived).toHaveLength(1);
    expect(archived[0]?.tenant_id).toBe(SYSTEM_TENANT_ID);
  });
});
