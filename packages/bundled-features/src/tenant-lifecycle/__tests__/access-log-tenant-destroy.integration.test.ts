import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { createTenantDb } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { accessLogTable } from "../../audit/access-log.ts";
import { createAuditFeature } from "../../audit/feature.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/feature.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createUserFeature } from "../../user/index.ts";
import { createTenantLifecycleFeature } from "../index.ts";
import { driveDestructionToCompletion, seedDestroyingTenant } from "../testing.ts";

const tenantOne = testTenantId(41);
const tenantTwo = testTenantId(42);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createComplianceProfilesFeature(),
      createAuditFeature(),
      createTenantLifecycleFeature(),
    ],
    jobs: { consumerLane: "worker" },
  });
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function seedAccessRow(tenantId: TenantId): Promise<void> {
  await createTenantDb({
    db: stack.db,
    tenantId,
    mode: "system",
    reason: "test seeds access log rows",
  }).insertOne(accessLogTable, {
    id: generateId(),
    tenantId,
    occurredAt: getTemporal().Now.instant(),
    actorId: "seed-actor",
    subjectType: "seed-doc",
    subjectId: "seed",
    action: "opened",
    details: {},
  });
}

describe("access log on tenant destroy", () => {
  test("destroying a tenant deletes its access log rows and keeps other tenants' rows", async () => {
    for (const [key, id] of [
      ["destroy-one", tenantOne],
      ["destroy-two", tenantTwo],
    ] as const) {
      await stack.http.writeOk(
        TenantHandlers.create,
        { id, key, name: key },
        TestUsers.systemAdmin,
      );
      await seedAccessRow(id);
      await seedAccessRow(id);
    }

    await seedDestroyingTenant(stack, tenantOne);
    expect(await driveDestructionToCompletion(stack, stack.db, tenantOne)).toBe("destroyed");

    expect(await selectMany(stack.db, accessLogTable, { tenantId: tenantOne })).toHaveLength(0);
    expect(await selectMany(stack.db, accessLogTable, { tenantId: tenantTwo })).toHaveLength(2);
  });
});
