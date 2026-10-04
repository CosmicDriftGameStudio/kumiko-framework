// With compliance-profiles mounted, the retention job prunes per tenant after the profile's
// auditLog.retention (eu-dsgvo 24 months, no profile row -> minimal-no-region 3 months).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { appendRaw } from "@cosmicdrift/kumiko-framework/event-store/admin-api";
import {
  createTestUser,
  drainEventConsumers,
  resetEventStore,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/feature.js";
import { createConfigFeature } from "../../config/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { createUserFeature } from "../../user/index.js";
import {
  ESCAPE_HATCH_USE_AGGREGATE_TYPE,
  ESCAPE_HATCH_USED_EVENT,
} from "../escape-hatch-audit-sink.js";
import { createAuditFeature } from "../feature.js";

const RETENTION_JOB = "audit:job:escape-hatch-retention";
const SET_PROFILE = "compliance-profiles:write:set-profile";
const tenantA = testTenantId(11);
const tenantB = testTenantId(12);
const adminA = createTestUser({ id: 11, tenantId: tenantA, roles: ["TenantAdmin"] });

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

beforeEach(async () => {
  await resetEventStore(stack, ["read_tenant_compliance_profiles"]);
});

async function seedEvent(tenantId: typeof tenantA, ageDays: number): Promise<string> {
  const aggregateId = generateId();
  await appendRaw(stack.db, {
    aggregateId,
    aggregateType: ESCAPE_HATCH_USE_AGGREGATE_TYPE,
    tenantId,
    expectedVersion: 0,
    type: ESCAPE_HATCH_USED_EVENT,
    payload: { handler: "seed", kind: "unsafe-raw", reason: "seed", actor: "system" },
    metadata: { userId: "system" },
    createdAt: getTemporal()
      .Now.instant()
      .subtract({ hours: ageDays * 24 }),
    createdBy: "system",
  });
  return aggregateId;
}

describe("escape-hatch retention with compliance-profiles", () => {
  test("each tenant is pruned after its own profile's auditLog.retention", async () => {
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, adminA);

    const a100 = await seedEvent(tenantA, 100);
    const a800 = await seedEvent(tenantA, 800);
    const b100 = await seedEvent(tenantB, 100);
    const b800 = await seedEvent(tenantB, 800);

    await drainEventConsumers(stack, ["system:consumer:sse-broadcast"]);
    if (!stack.jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");
    await stack.jobRunner.dispatch(RETENTION_JOB, {});
    await stack.drainJobs();

    const remaining = new Set(
      (
        await selectMany<{ aggregateId: string }>(stack.db, eventsTable, {
          aggregateType: ESCAPE_HATCH_USE_AGGREGATE_TYPE,
        })
      ).map((row) => row.aggregateId),
    );
    expect(remaining.has(a100)).toBe(true);
    expect(remaining.has(a800)).toBe(false);
    expect(remaining.has(b100)).toBe(false);
    expect(remaining.has(b800)).toBe(false);
  });
});
