// The access log is pruned per tenant after the compliance profile's auditLog.retention
// (eu-dsgvo 24 months, no profile row -> minimal-no-region 3 months).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { createTenantDb } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/feature.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createUserFeature } from "../../user/index.ts";
import { accessLogTable } from "../access-log.ts";
import { createAuditFeature } from "../feature.ts";

const RETENTION_JOB = "audit:job:access-log-retention";
const SET_PROFILE = "compliance-profiles:write:set-profile";
const tenantA = testTenantId(31);
const tenantB = testTenantId(32);
const adminA = createTestUser({ id: 31, tenantId: tenantA, roles: ["TenantAdmin"] });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createComplianceProfilesFeature(),
      createAuditFeature(),
    ],
    jobs: { consumerLane: "worker" },
  });
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function seedRow(tenantId: TenantId, ageDays: number): Promise<string> {
  const id = generateId();
  await createTenantDb({
    db: stack.db,
    tenantId,
    mode: "system",
    reason: "test seeds access log rows",
  }).insertOne(accessLogTable, {
    id,
    tenantId,
    occurredAt: getTemporal()
      .Now.instant()
      .subtract({ hours: ageDays * 24 }),
    actorId: "seed-actor",
    subjectType: "seed-doc",
    subjectId: "seed",
    action: "opened",
    details: {},
  });
  return id;
}

async function remainingIds(tenantId: TenantId): Promise<Set<string>> {
  const rows = await selectMany(stack.db, accessLogTable, { tenantId });
  return new Set(rows.map((row) => row.id));
}

describe("access log retention", () => {
  test("each tenant is pruned after its own profile's auditLog.retention", async () => {
    for (const [key, id] of [
      ["retention-a", tenantA],
      ["retention-b", tenantB],
    ] as const) {
      await stack.http.writeOk(
        TenantHandlers.create,
        { id, key, name: key },
        TestUsers.systemAdmin,
      );
    }
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, adminA);

    const a100 = await seedRow(tenantA, 100);
    const a800 = await seedRow(tenantA, 800);
    const b100 = await seedRow(tenantB, 100);
    const b800 = await seedRow(tenantB, 800);

    if (!stack.jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");
    await stack.jobRunner.dispatch(RETENTION_JOB, {});
    await stack.drainJobs();

    const remainingA = await remainingIds(tenantA);
    expect(remainingA.has(a100)).toBe(true);
    expect(remainingA.has(a800)).toBe(false);
    const remainingB = await remainingIds(tenantB);
    expect(remainingB.has(b100)).toBe(false);
    expect(remainingB.has(b800)).toBe(false);
  });
});
