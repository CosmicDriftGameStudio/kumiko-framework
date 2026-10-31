import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  EXT_EXTERNAL_RESOURCE,
  type TenantDestroyHookResult,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createTestEnvelopeCipher, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { userSessionTable } from "../../sessions/schema/user-session.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/index.ts";
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createUserFeature } from "../../user/feature.ts";
import {
  DESTRUCTION_STAGE_MAX_PENDING_MS,
  TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_QN,
  TENANT_DESTRUCTION_STAGE_FAILED_EVENT_QN,
  TENANT_DESTRUCTION_STAGE_PROGRESSED_EVENT_QN,
  TENANT_DESTRUCTION_STAGE_STARTED_EVENT_QN,
  TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_QN,
} from "../constants.ts";
import {
  createTenantLifecycleFeature,
  resolveTenantLifecycleGate,
  TenantLifecycleHandlers,
} from "../index.ts";
import { resetTenantLifecycleGateCacheForTests } from "../lifecycle-gate.ts";
import { runTenantDestructionSweep } from "../run-tenant-destroy.ts";

const STAGE_MAX_ATTEMPTS = 3;
const EXTERNAL_STAGE = "external-resources";
const tenantAdmin = TestUsers.admin;

let stack: TestStack;
let hookCalls = 0;
let answerHook: (call: number) => TenantDestroyHookResult = () => ({ done: true });

const externalTeardownFeature = defineFeature("test-pending-external-teardown", (r) => {
  r.requires({ features: ["tenant-lifecycle"] });
  r.useExtension(EXT_EXTERNAL_RESOURCE, "remote-teardown", {
    destroyTenant: async () => {
      hookCalls++;
      return answerHook(hookCalls);
    },
  });
});

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createTenantLifecycleFeature(),
      externalTeardownFeature,
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      resolveTenantLifecycleStatus: async (tenantId: TenantId) => {
        const gate = await resolveTenantLifecycleGate(stack.db, tenantId);
        return gate ? { status: gate.status } : null;
      },
    } as import("@cosmicdrift/kumiko-framework/api").AuthRoutesConfig,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  hookCalls = 0;
  stack.events.reset();
  resetTenantLifecycleGateCacheForTests();
  await resetTestTables(stack.db, [
    tenantTable,
    tenantComplianceProfileTable,
    userSessionTable,
    tenantMembershipsTable,
    eventsTable,
  ]);
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: tenantAdmin.tenantId, key: "acme", name: "ACME Corp" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(
    "compliance-profiles:write:set-profile",
    { profileKey: "eu-dsgvo" },
    tenantAdmin,
  );
  await stack.http.writeOk(TenantLifecycleHandlers.requestDestruction, {}, tenantAdmin);
});

// Past the grace period, so every sweep tick is allowed to run a stage.
function afterGracePeriod(): Temporal.Instant {
  return getTemporal()
    .Now.instant()
    .add({ hours: 24 * 3650 });
}

async function sweepUntilSettled(nowForTick: (tick: number) => Temporal.Instant): Promise<string> {
  for (let tick = 0; tick < 40; tick++) {
    await runTenantDestructionSweep({
      db: stack.db,
      registry: stack.registry,
      now: nowForTick(tick),
    });
    const rows = await selectMany(stack.db, tenantTable, { id: tenantAdmin.tenantId });
    const status = String(rows[0]?.["status"]);
    if (status === "destroyed" || status === "destroyFailed") return status;
  }
  return "unsettled";
}

async function externalStageEvents(type: string): Promise<Record<string, unknown>[]> {
  const events = await selectMany(stack.db, eventsTable, { aggregateId: tenantAdmin.tenantId });
  return events.flatMap((e) => {
    const payload = e["payload"];
    const isExternalStageEvent =
      e["type"] === type && isPlainObject(payload) && payload["stage"] === EXTERNAL_STAGE;
    return isExternalStageEvent ? [payload] : [];
  });
}

describe("tenant-lifecycle :: pending destroy hook", () => {
  test("pending ticks inside the window are no attempts and the stage finishes once the hook is done", async () => {
    const PENDING_TICKS = STAGE_MAX_ATTEMPTS + 3;
    answerHook = (call) =>
      call <= PENDING_TICKS ? { done: false, processed: 0, pending: true } : { done: true };
    const start = afterGracePeriod();
    const tickSpacingMs = DESTRUCTION_STAGE_MAX_PENDING_MS / (PENDING_TICKS + 2);

    const status = await sweepUntilSettled((tick) =>
      start.add({ milliseconds: tick * tickSpacingMs }),
    );

    expect(status).toBe("destroyed");
    expect(hookCalls).toBe(PENDING_TICKS + 1);
    expect(await externalStageEvents(TENANT_DESTRUCTION_STAGE_STARTED_EVENT_QN)).toHaveLength(1);
    expect(await externalStageEvents(TENANT_DESTRUCTION_STAGE_FAILED_EVENT_QN)).toHaveLength(0);
    const progressed = await externalStageEvents(TENANT_DESTRUCTION_STAGE_PROGRESSED_EVENT_QN);
    expect(progressed).toHaveLength(PENDING_TICKS);
    expect(progressed.every((payload) => payload["pending"] === true)).toBe(true);
    expect(await externalStageEvents(TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_QN)).toHaveLength(1);
  });

  test("a hook that stays pending past the window fails each attempt and is abandoned", async () => {
    answerHook = () => ({ done: false, processed: 0, pending: true });
    const start = afterGracePeriod();

    const status = await sweepUntilSettled((tick) =>
      start.add({ milliseconds: tick * (DESTRUCTION_STAGE_MAX_PENDING_MS + 60_000) }),
    );

    expect(status).toBe("destroyFailed");
    const failed = await externalStageEvents(TENANT_DESTRUCTION_STAGE_FAILED_EVENT_QN);
    expect(failed).toHaveLength(STAGE_MAX_ATTEMPTS - 1);
    expect(failed.every((payload) => String(payload["error"]).includes("still pending"))).toBe(
      true,
    );
    const abandoned = await externalStageEvents(TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_QN);
    expect(abandoned).toHaveLength(1);
    expect(String(abandoned[0]?.["error"])).toContain("still pending");
    expect(await externalStageEvents(TENANT_DESTRUCTION_STAGE_STARTED_EVENT_QN)).toHaveLength(
      STAGE_MAX_ATTEMPTS,
    );
    expect(await externalStageEvents(TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_QN)).toHaveLength(0);
  });
});
