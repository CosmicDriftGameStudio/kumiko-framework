// swapShadowIntoLive and the rebuild guards against live tables with row level security.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { testTenantId } from "../../seeding/seed-users.ts";
import type { DbTx } from "../connection.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { assertRebuildableRowLevelSecurity } from "../queries/rebuild-rls-guard.ts";
import { readRowLevelSecurityState } from "../queries/rls-catalog.ts";
import {
  buildShadowTable,
  ensureRebuildSchema,
  PROJECTION_REBUILD_SCHEMA,
  swapShadowIntoLive,
} from "../queries/shadow-swap.ts";
import { asRawClient } from "../query.ts";
import { unsafePushTables } from "../table-push.ts";
import { createProbeRole } from "./rls-probe.ts";

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

describe("assertRebuildableRowLevelSecurity", () => {
  async function pushed(name: string, mode: "on" | "off") {
    await unsafePushTables(testDb.db, { live: tenantTable(name) }, undefined, {
      rowLevelSecurity: mode,
    });
  }
  const check = (name: string) =>
    testDb.db.begin((tx: DbTx) => assertRebuildableRowLevelSecurity(tx, name));

  test("passes for the framework policies, foreign permissive policies and a table without RLS", async () => {
    await pushed("store_guard_ok", "on");
    await asRawClient(testDb.db).unsafe(
      `CREATE POLICY foreign_permissive ON "store_guard_ok" AS PERMISSIVE FOR UPDATE TO PUBLIC USING (false)`,
    );
    await pushed("store_guard_off", "off");
    await expect(check("store_guard_ok")).resolves.toBeUndefined();
    await expect(check("store_guard_off")).resolves.toBeUndefined();
  });

  test("rejects a RESTRICTIVE policy and names the table and the policy", async () => {
    await pushed("store_guard_restrictive", "on");
    await asRawClient(testDb.db).unsafe(
      `CREATE POLICY hand_restrictive ON "store_guard_restrictive" AS RESTRICTIVE FOR SELECT TO PUBLIC USING (true)`,
    );
    await expect(check("store_guard_restrictive")).rejects.toThrow(
      /public\.store_guard_restrictive.*hand_restrictive \(RESTRICTIVE SELECT\)/,
    );
  });

  test("rejects an enabled table whose tenant isolation policy is missing", async () => {
    await pushed("store_guard_missing", "on");
    await asRawClient(testDb.db).unsafe(
      `DROP POLICY kumiko_tenant_isolation ON "store_guard_missing"`,
    );
    await expect(check("store_guard_missing")).rejects.toThrow(/public\.store_guard_missing/);
  });
});
