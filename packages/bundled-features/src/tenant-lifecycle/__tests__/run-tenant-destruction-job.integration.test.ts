// The minute cron only takes ctx.db.unsafeRaw() when a tenant is due: the idle probe runs
// through ctx.crossTenantReads and reports a cross-tenant-read instead of an unsafe-raw.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { EscapeHatchUseEvent, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createNoopProvider,
  createPrometheusMeter,
} from "@cosmicdrift/kumiko-framework/observability";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createTestEnvelopeCipher,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { TenantHandlers } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantTable } from "../../tenant/schema/tenant.js";
import { createTenantLifecycleFeature } from "../feature.js";

const JOB = "tenant-lifecycle:job:run-tenant-destruction";
const DUE_TENANT = testTenantId(9101) as TenantId;

const meter = createPrometheusMeter();
const auditEvents: EscapeHatchUseEvent[] = [];
let stack: TestStack;

function auditedKinds(): string[] {
  return auditEvents.filter((e) => e.handler === JOB).map((e) => e.kind);
}

function meteredUses(kind: string): number {
  const slots = meter.snapshot().get("kumiko_escape_hatch_uses_total")?.slots ?? [];
  return slots
    .filter((s) => s.labels?.["handler"] === JOB && s.labels?.["kind"] === kind)
    .reduce((sum, s) => sum + ("value" in s ? s.value : 0), 0);
}

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
      _escapeHatchAuditSink: async (event: EscapeHatchUseEvent) => {
        auditEvents.push(event);
      },
    },
    observability: { ...createNoopProvider(), meter },
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  auditEvents.length = 0;
  await resetTestTables(stack.db, [tenantTable]);
});

async function runJob(): Promise<void> {
  await stack.jobRunner?.dispatch(JOB, {});
  await stack.drainJobs();
}

describe("run-tenant-destruction cron", () => {
  test("without a due tenant it reports no unsafe-raw", async () => {
    const usesBefore = meteredUses("unsafe-raw");

    await runJob();

    expect(auditedKinds()).not.toContain("unsafe-raw");
    expect(meteredUses("unsafe-raw")).toBe(usesBefore);
    expect(auditedKinds()).toContain("cross-tenant-read");
    expect(meteredUses("cross-tenant-read")).toBeGreaterThan(0);
  });

  test("with a destroying tenant the sweep runs and reports unsafe-raw", async () => {
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: DUE_TENANT, key: "due-acme", name: "ACME Corp" },
      TestUsers.systemAdmin,
    );
    await updateRows(stack.db, tenantTable, { status: "destroying" }, { id: DUE_TENANT });
    const usesBefore = meteredUses("unsafe-raw");

    await runJob();

    expect(auditedKinds()).toContain("unsafe-raw");
    expect(meteredUses("unsafe-raw")).toBeGreaterThan(usesBefore);
    const events = await loadAggregate(stack.db, DUE_TENANT, DUE_TENANT);
    expect(events.some((e) => e.type.includes("destruction-stage"))).toBe(true);
  });
});
