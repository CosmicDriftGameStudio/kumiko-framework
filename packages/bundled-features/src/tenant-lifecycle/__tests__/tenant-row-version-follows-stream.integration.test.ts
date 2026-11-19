// Stage events land on the tenant's own stream. The read_tenants row version must follow that
// stream on the live path, as a rebuild aligns it, or a SystemAdmin edit of a destroying tenant
// fails with version_conflict and live and rebuilt rows disagree.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createTenantLifecycleFeature } from "../feature.ts";
import { runNextDestructionStage } from "../run-tenant-destroy.ts";
import { seedDestroyingTenant } from "../testing.ts";

const TENANT_PROJECTION = "tenant:projection:tenant-entity";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
    ],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [tenantTable, eventsTable]);
});

async function createTenant(): Promise<TenantId> {
  const created = await stack.http.writeOk<{ id: string }>(
    TenantHandlers.create,
    { key: "version-follows", name: "Version Follows GmbH" },
    TestUsers.systemAdmin,
  );
  return created.id as TenantId;
}

async function tenantRow(tenantId: TenantId): Promise<Record<string, unknown> | undefined> {
  const rows = await selectMany<Record<string, unknown>>(stack.db, tenantTable, { id: tenantId });
  return rows[0];
}

async function streamVersion(tenantId: TenantId): Promise<number> {
  return (await loadAggregate(stack.db, tenantId, SYSTEM_TENANT_ID)).at(-1)?.version ?? 0;
}

describe("tenant-lifecycle :: tenant row version follows the stream", () => {
  test("after a stage tick the row carries the stream version, a SystemAdmin edit applies and a rebuild keeps the row", async () => {
    const tenantId = await createTenant();
    await seedDestroyingTenant(stack, tenantId);
    expect((await tenantRow(tenantId))?.["version"]).toBe(await streamVersion(tenantId));

    await runNextDestructionStage({ db: stack.db, registry: stack.registry, tenantId });

    const afterStage = await tenantRow(tenantId);
    expect(afterStage?.["status"]).toBe("destroying");
    expect(afterStage?.["version"]).toBe(await streamVersion(tenantId));

    await stack.http.writeOk(
      TenantHandlers.update,
      { id: tenantId, version: afterStage?.["version"], changes: { name: "Renamed GmbH" } },
      TestUsers.systemAdmin,
    );

    const live = await tenantRow(tenantId);
    expect(live?.["version"]).toBe(await streamVersion(tenantId));
    await rebuildProjection(TENANT_PROJECTION, { db: stack.db, registry: stack.registry });
    expect(await tenantRow(tenantId)).toEqual(live);
  });
});
