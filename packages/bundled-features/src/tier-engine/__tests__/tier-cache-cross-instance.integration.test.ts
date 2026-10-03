// Two stacks on one Redis namespace and one DB stand in for two API pods: a
// tier change through pod A must reach pod B's in-process tier cache.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configValuesTable } from "@cosmicdrift/kumiko-bundled-features/config";
import { tenantSecretsTable } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { tenantMembershipsTable, tenantTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  findTierResolverUsage,
  isTierResolverPlugin,
  type TenantId,
  type TierResolverPlugin,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestDb,
  createTestUser,
  setupTestStack,
  type TestDb,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import * as z from "zod";
import type { TierMap } from "../compose-app.js";
import { tierAssignmentEntity } from "../entity.js";
import { createTierEngineFeature } from "../feature.js";

const TIER_MAP: TierMap<{ readonly maxItems: number }> = {
  free: { features: [], caps: { maxItems: 1 } },
  pro: { features: ["feat-pro"], caps: { maxItems: 5 } },
};

const featProFeature = defineFeature("feat-pro", (r) => {
  r.toggleable({ default: false });
  r.queryHandler("ping", z.object({}), async () => ({ ok: true }), {
    access: { roles: ["TenantAdmin"] },
  });
});

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);
const tenant = "00000000-0000-4000-8000-0000000000c1" as TenantId;
const sysUser = createTestUser({
  id: "sys-x",
  tenantId: tenant,
  roles: ["SystemAdmin", "TenantAdmin"],
});

type Pod = { readonly stack: TestStack };

async function bootPod(dbName: string, sharedRedisWith?: TestStack): Promise<Pod> {
  const features = composeFeatures(
    [createTierEngineFeature({ tierMap: TIER_MAP }), featProFeature],
    { includeBundled: true },
  );
  const usage = findTierResolverUsage(features);
  if (!usage || !isTierResolverPlugin(usage.options)) {
    throw new Error("setup failure: no tier-resolver plugin registered");
  }
  const plugin = usage.options;
  // The resolver needs the stack's bus and db, which only exist after setup.
  const holder: {
    resolve?: ReturnType<TierResolverPlugin["build"]> extends Promise<infer R> ? R : never;
  } = {};
  const stack = await setupTestStack({
    features,
    dbName,
    persistentDb: true,
    cacheSync: true,
    ...(sharedRedisWith && { sharedRedisWith }),
    effectiveFeatures: (tenantId) => {
      if (!holder.resolve) throw new Error("resolver not built yet");
      return holder.resolve(tenantId);
    },
  });
  await unsafePushTables(stack.db, {
    config_values: configValuesTable,
    users: userTable,
    tenants: tenantTable,
    tenant_memberships: tenantMembershipsTable,
    tenant_secrets: tenantSecretsTable,
    tier_assignments: tierAssignmentTable,
  });
  holder.resolve = await plugin.build({
    db: stack.db,
    registry: stack.registry,
    cacheSync: stack.cacheSync,
  });
  return { stack };
}

describe("tier cache across instances", () => {
  let sharedDb: TestDb;
  let podA: Pod;
  let podB: Pod;
  const tenantAdmin = createTestUser({ id: "ta-x", tenantId: tenant, roles: ["TenantAdmin"] });

  const pingOnB = async (): Promise<number> => {
    const res = await podB.stack.http.queryWithHeaders("feat-pro:query:ping", {}, tenantAdmin, {});
    return res.status;
  };

  beforeAll(async () => {
    sharedDb = await createTestDb();
    podA = await bootPod(sharedDb.dbName);
    podB = await bootPod(sharedDb.dbName, podA.stack);
  });

  afterAll(async () => {
    await podB.stack.cleanup();
    await podA.stack.cleanup();
    await sharedDb.cleanup();
  });

  test("set-tenant-tier on pod A upgrades, then downgrades, the tenant on pod B", async () => {
    expect(await pingOnB()).toBe(403);

    await podA.stack.http.writeOk(
      "tier-engine:write:set-tenant-tier",
      { tenantId: tenant, tier: "pro" },
      sysUser,
    );
    await waitFor(async () => (await pingOnB()) === 200);

    await podA.stack.http.writeOk(
      "tier-engine:write:set-tenant-tier",
      { tenantId: tenant, tier: "free" },
      sysUser,
    );
    await waitFor(async () => (await pingOnB()) === 403);
  });

  test("a tier-assignment CRUD update on pod A reaches pod B", async () => {
    type Row = { readonly id: string; readonly version: number; readonly tier: string };
    const list = await podA.stack.http.queryOk<{ rows: readonly Row[] }>(
      "tier-engine:query:tier-assignment:list",
      {},
      sysUser,
    );
    const row = list.rows[0];
    if (!row) throw new Error("no tier-assignment row from the previous test");
    expect(await pingOnB()).toBe(403);

    await podA.stack.http.writeOk(
      "tier-engine:write:tier-assignment:update",
      { id: row.id, version: row.version, changes: { tier: "pro" } },
      sysUser,
    );
    await waitFor(async () => (await pingOnB()) === 200);
  });
});
