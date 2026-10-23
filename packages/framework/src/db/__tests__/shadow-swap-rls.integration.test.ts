// swapShadowIntoLive and the rebuild guards against live tables with row level security.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { testTenantId } from "../../seeding/seed-users.ts";
import type { DbTx } from "../connection.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { readRowLevelSecurityState } from "../queries/rls-catalog.ts";
import {
  buildShadowTable,
  countColumnDrift,
  ensureRebuildSchema,
  PROJECTION_REBUILD_SCHEMA,
  refuseRowLevelSecurityFilteredReads,
  swapShadowIntoLive,
} from "../queries/shadow-swap.ts";
import { asRawClient } from "../query.ts";
import { unsafePushTables } from "../table-push.ts";
import {
  asProbe,
  createProbeRole,
  INSUFFICIENT_PRIVILEGE,
  PROBE_ROLE,
  pgCodeOf,
} from "./rls-probe.ts";

function tenantTable(tableName: string) {
  return defineUnmanagedTable({
    tableName,
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
}

const tenantB = testTenantId(221);
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await ensureRebuildSchema(testDb.db);
  await createProbeRole(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("swapShadowIntoLive", () => {
  test("waits out an in-flight ENABLE and CREATE POLICY and carries them over", async () => {
    const meta = tenantTable("store_swap_inflight");
    await unsafePushTables(testDb.db, { live: meta });
    const raw = asRawClient(testDb.db);
    let enableStarted!: () => void;
    const enableStartedSignal = new Promise<void>((resolve) => {
      enableStarted = resolve;
    });
    let commitEnable!: () => void;
    const commitEnableSignal = new Promise<void>((resolve) => {
      commitEnable = resolve;
    });
    const enabler = testDb.db.begin(async (btx: DbTx) => {
      const braw = asRawClient(btx);
      await braw.unsafe(`ALTER TABLE "store_swap_inflight" ENABLE ROW LEVEL SECURITY`);
      await braw.unsafe(`CREATE POLICY in_flight ON "store_swap_inflight" USING (true)`);
      enableStarted();
      await commitEnableSignal;
    });
    try {
      await enableStartedSignal;
      const swap = testDb.db.begin(async (tx: DbTx) => {
        await buildShadowTable(tx, meta);
        await swapShadowIntoLive(tx, "store_swap_inflight");
      });
      await waitFor(async () => {
        const [waiting] = await raw.unsafe<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks
           WHERE NOT granted AND relation = 'public.store_swap_inflight'::regclass`,
        );
        return (waiting?.n ?? 0) > 0;
      });
      commitEnable();
      await enabler;
      await swap;
      const after = await readRowLevelSecurityState(testDb.db, "public", "store_swap_inflight");
      expect(after).toMatchObject({ enabled: true, forced: false });
      expect(after?.policies.map((p) => p.name)).toEqual(["in_flight"]);
    } finally {
      commitEnable();
      await enabler.catch(() => undefined);
    }
  });

  test("a failing policy restore rolls the whole swap back", async () => {
    const meta = tenantTable("store_swap_rollback");
    await unsafePushTables(testDb.db, { live: meta }, undefined, { rowLevelSecurity: "on" });
    const raw = asRawClient(testDb.db);
    await raw.unsafe(`ALTER TABLE "store_swap_rollback" ADD COLUMN extra boolean`);
    await raw.unsafe(
      `CREATE POLICY needs_extra ON "store_swap_rollback" AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (extra IS NOT TRUE)`,
    );
    await raw.unsafe(
      `INSERT INTO "store_swap_rollback" (tenant_id, label) VALUES ($1::uuid, 'one'), ($1::uuid, 'two')`,
      [tenantB],
    );
    const before = await readRowLevelSecurityState(testDb.db, "public", "store_swap_rollback");
    expect(before?.policies.map((p) => p.name)).toEqual([
      "kumiko_system_tenant_read",
      "kumiko_tenant_isolation",
      "needs_extra",
    ]);

    // The shadow has no `extra` column, so recreating needs_extra must fail.
    await expect(
      testDb.db.begin(async (tx: DbTx) => {
        await buildShadowTable(tx, meta);
        await swapShadowIntoLive(tx, "store_swap_rollback");
      }),
    ).rejects.toThrow(/extra/);

    expect(await readRowLevelSecurityState(testDb.db, "public", "store_swap_rollback")).toEqual(
      before,
    );
    const rows = await raw.unsafe<{ label: string; extra: boolean | null }>(
      `SELECT label, extra FROM "store_swap_rollback" ORDER BY label`,
    );
    expect(rows.map((r) => r.label)).toEqual(["one", "two"]);
    const [shadow] = await raw.unsafe<{ found: string | null }>(
      `SELECT to_regclass('${PROJECTION_REBUILD_SCHEMA}.store_swap_rollback')::text AS found`,
    );
    expect(shadow?.found).toBeNull();
  });
});

describe("refuseRowLevelSecurityFilteredReads", () => {
  test("a policy-filtered guard read fails instead of seeing no rows", async () => {
    const meta = tenantTable("store_swap_filtered");
    await unsafePushTables(testDb.db, { live: meta }, undefined, { rowLevelSecurity: "on" });
    const raw = asRawClient(testDb.db);
    const rowId = "00000000-0000-4000-8000-0000000000d1";
    await raw.unsafe(
      `INSERT INTO "store_swap_filtered" (id, tenant_id, label) VALUES ($1::uuid, $2::uuid, 'live')`,
      [rowId, tenantB],
    );
    await testDb.db.begin((tx: DbTx) => buildShadowTable(tx, meta));
    try {
      const shadowTable = `${PROJECTION_REBUILD_SCHEMA}."store_swap_filtered"`;
      await raw.unsafe(
        `INSERT INTO ${shadowTable} (id, tenant_id, label) VALUES ($1::uuid, $2::uuid, 'shadow')`,
        [rowId, tenantB],
      );
      await raw.unsafe(`GRANT USAGE ON SCHEMA ${PROJECTION_REBUILD_SCHEMA} TO ${PROBE_ROLE}`);
      await raw.unsafe(`GRANT SELECT ON ${shadowTable} TO ${PROBE_ROLE}`);
      await raw.unsafe(`GRANT SELECT ON "store_swap_filtered" TO ${PROBE_ROLE}`);

      const superuserView = await countColumnDrift(testDb.db, "store_swap_filtered", meta);
      expect(superuserView.rowCount).toBe(1);

      const filteredView = await asProbe(testDb.db, {}, (_raw, tx) =>
        countColumnDrift(tx, "store_swap_filtered", meta),
      );
      expect(filteredView.rowCount).toBe(0);

      const refusedCode = await asProbe(testDb.db, {}, async (_raw, tx) => {
        await refuseRowLevelSecurityFilteredReads(tx);
        return pgCodeOf(countColumnDrift(tx, "store_swap_filtered", meta));
      });
      expect(refusedCode).toBe(INSUFFICIENT_PRIVILEGE);
    } finally {
      await raw.unsafe(`DROP TABLE IF EXISTS ${PROJECTION_REBUILD_SCHEMA}."store_swap_filtered"`);
    }
  });

  test("a superuser connection is unaffected", async () => {
    const meta = tenantTable("store_swap_superuser");
    await unsafePushTables(testDb.db, { live: meta }, undefined, { rowLevelSecurity: "on" });
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "store_swap_superuser" (tenant_id, label) VALUES ($1::uuid, 'live')`,
      [tenantB],
    );
    await testDb.db.begin(async (tx: DbTx) => {
      await refuseRowLevelSecurityFilteredReads(tx);
      const rows = await asRawClient(tx).unsafe<{ n: number }>(
        `SELECT count(*)::int AS n FROM "store_swap_superuser" WHERE tenant_id = $1::uuid`,
        [tenantB],
      );
      expect(rows[0]?.n).toBe(1);
    });
  });
});
