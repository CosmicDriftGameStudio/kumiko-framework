import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  EXT_TENANT_DATA,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  append,
  createEventsTable,
  eventsTable,
  loadAggregate,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createTestEnvelopeCipher,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createSessionsFeature } from "../../sessions";
import { userSessionEntity, userSessionTable } from "../../sessions/schema/user-session";
import { TenantHandlers, TenantQueries } from "../../tenant/constants";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { createUserFeature } from "../../user/feature";
import {
  TENANT_AGGREGATE_TYPE,
  TENANT_DESTRUCTION_FAILED_EVENT_QN,
  TENANT_DESTRUCTION_STARTED_EVENT_QN,
} from "../constants";
import {
  createTenantLifecycleFeature,
  resolveTenantLifecycleGate,
  TenantLifecycleHandlers,
} from "../index";
import { runNextDestructionStage } from "../run-tenant-destroy";

const REQUEST = TenantLifecycleHandlers.requestDestruction;
const CANCEL = TenantLifecycleHandlers.cancelDestruction;
const SET_PROFILE = "compliance-profiles:write:set-profile";

let stack: TestStack;
let db: DbConnection;
const tenantAdmin = TestUsers.admin;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createSessionsFeature(),
      createTenantLifecycleFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      resolveTenantLifecycleStatus: async (tenantId: TenantId) => {
        const gate = await resolveTenantLifecycleGate(stack.db, tenantId);
        return gate ? { status: gate.status } : null;
      },
    } as import("@cosmicdrift/kumiko-framework/api").AuthRoutesConfig,
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, userSessionEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await createEventsTable(db);
  await unsafePushTables(db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  stack.events.reset();
  await resetTestTables(db, [
    tenantTable,
    tenantComplianceProfileTable,
    userSessionTable,
    eventsTable,
  ]);
});

async function seedTenant(): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: tenantAdmin.tenantId, key: "acme", name: "ACME Corp" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantAdmin);
}

describe("tenant-lifecycle :: request / cancel / 410 gate", () => {
  test("request destruction sets destroyRequested + grace", async () => {
    await seedTenant();
    const result = await stack.http.writeOk<{
      status: string;
      gracePeriodEnd: string;
    }>(REQUEST, {}, tenantAdmin);
    expect(result.status).toBe("destroyRequested");
    expect(result.gracePeriodEnd).toBeTruthy();

    const rows = await selectMany(db, tenantTable, { id: tenantAdmin.tenantId });
    expect(rows[0]?.["status"]).toBe("destroyRequested");
  });

  test("API returns 410 after destruction requested", async () => {
    await seedTenant();
    await stack.http.writeOk(REQUEST, {}, tenantAdmin);

    const res = await stack.http.query(TenantQueries.me, {}, tenantAdmin);
    expect(res.status).toBe(410);
  });

  test("cancel within grace restores active tenant", async () => {
    await seedTenant();
    await stack.http.writeOk(REQUEST, {}, tenantAdmin);
    const cancelled = await stack.http.writeOk<{ status: string }>(CANCEL, {}, tenantAdmin);
    expect(cancelled.status).toBe("active");

    const me = await stack.http.queryOk(TenantQueries.me, {}, tenantAdmin);
    expect(me).not.toBeNull();
  });

  test("cancel after grace expired returns grace_period_expired", async () => {
    await seedTenant();
    await stack.http.writeOk(REQUEST, {}, tenantAdmin);
    const past = (await import("@cosmicdrift/kumiko-framework/time"))
      .getTemporal()
      .Now.instant()
      .subtract({
        hours: 1,
      });
    await updateRows(db, tenantTable, { gracePeriodEnd: past }, { id: tenantAdmin.tenantId });

    const err = await stack.http.writeErr(CANCEL, {}, tenantAdmin);
    expect(err.httpStatus).toBe(422);
    expect((err.details as { reason?: string } | undefined)?.reason).toBe("grace_period_expired");
  });

  test("non-admin cannot request destruction", async () => {
    await seedTenant();
    const member = createTestUser({ id: 99, roles: ["Member"] });
    const err = await stack.http.writeErr(REQUEST, {}, member);
    expect(err.httpStatus).toBe(403);
  });
});

function createPoisonTenantDataFeature() {
  return defineFeature("test-poison-tenant-data", (r) => {
    r.requires("tenant-lifecycle");
    r.useExtension(EXT_TENANT_DATA, "poison-pill", {
      destroy: async () => {
        throw new Error("poison-pill");
      },
    });
  });
}

describe("tenant-lifecycle :: pipeline abandon / destroyFailed", () => {
  let poisonStack: TestStack;

  beforeAll(async () => {
    const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
    const resolver = createConfigResolver({ cipher: encryption });
    poisonStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createTenantFeature(),
        createComplianceProfilesFeature(),
        createTenantLifecycleFeature(),
        createPoisonTenantDataFeature(),
      ],
      extraContext: { configResolver: resolver, configEncryption: encryption },
      authConfig: {
        resolveTenantLifecycleStatus: async (tenantId: TenantId) => {
          const gate = await resolveTenantLifecycleGate(poisonStack.db, tenantId);
          return gate ? { status: gate.status } : null;
        },
      } as import("@cosmicdrift/kumiko-framework/api").AuthRoutesConfig,
    });
    await unsafeCreateEntityTable(poisonStack.db, tenantEntity);
    await unsafeCreateEntityTable(poisonStack.db, tenantComplianceProfileEntity);
    await createEventsTable(poisonStack.db);
    await unsafePushTables(poisonStack.db, { configValuesTable });
  });

  afterAll(async () => {
    await poisonStack.cleanup();
  });

  beforeEach(async () => {
    poisonStack.events.reset();
    await resetTestTables(poisonStack.db, [tenantTable, tenantComplianceProfileTable, eventsTable]);
  });

  async function seedDestroyingTenant(): Promise<void> {
    await poisonStack.http.writeOk(
      TenantHandlers.create,
      { id: tenantAdmin.tenantId, key: "acme", name: "ACME Corp" },
      TestUsers.systemAdmin,
    );
    await poisonStack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantAdmin);
    const T = (await import("@cosmicdrift/kumiko-framework/time")).getTemporal();
    const now = T.Now.instant();
    await updateRows(
      poisonStack.db,
      tenantTable,
      { status: "destroying", destroyStartedAt: now },
      { id: tenantAdmin.tenantId },
    );
    await append(poisonStack.db, {
      aggregateId: tenantAdmin.tenantId,
      aggregateType: TENANT_AGGREGATE_TYPE,
      tenantId: tenantAdmin.tenantId,
      expectedVersion:
        (await loadAggregate(poisonStack.db, tenantAdmin.tenantId, tenantAdmin.tenantId)).at(-1)
          ?.version ?? 0,
      type: TENANT_DESTRUCTION_STARTED_EVENT_QN,
      payload: { startedAt: now.toString() },
      metadata: { userId: "system", requestId: "test:destruction-started" },
    });
  }

  test("abandoned app-data stage halts pipeline as destroyFailed without tombstone", async () => {
    await seedDestroyingTenant();
    let halted = false;
    for (let i = 0; i < 12; i++) {
      const result = await runNextDestructionStage({
        db: poisonStack.db,
        registry: poisonStack.registry,
        tenantId: tenantAdmin.tenantId,
      });
      if (result.halted) {
        halted = true;
        break;
      }
      if (result.done) break;
    }
    expect(halted).toBe(true);

    const rows = await selectMany(poisonStack.db, tenantTable, { id: tenantAdmin.tenantId });
    expect(rows[0]?.["status"]).toBe("destroyFailed");
    expect(rows[0]?.["destroyedAt"]).toBeNull();

    const events = await selectMany(poisonStack.db, eventsTable, {
      aggregateId: tenantAdmin.tenantId,
    });
    expect(events.some((e) => e["type"] === TENANT_DESTRUCTION_FAILED_EVENT_QN)).toBe(true);
    expect(events.some((e) => String(e["type"]).includes("tenant-destruction-completed"))).toBe(
      false,
    );
  });

  test("destroyFailed tenant returns 410 on API", async () => {
    await seedDestroyingTenant();
    for (let i = 0; i < 12; i++) {
      const result = await runNextDestructionStage({
        db: poisonStack.db,
        registry: poisonStack.registry,
        tenantId: tenantAdmin.tenantId,
      });
      if (result.halted || result.done) break;
    }
    const res = await poisonStack.http.query(TenantQueries.me, {}, tenantAdmin);
    expect(res.status).toBe(410);
  });
});

describe("tenant-lifecycle :: batch cancel exemption", () => {
  test("cancel via /api/batch during grace succeeds", async () => {
    await seedTenant();
    await stack.http.writeOk(REQUEST, {}, tenantAdmin);
    const res = await stack.http.batch([{ type: CANCEL, payload: {} }], tenantAdmin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      isSuccess: boolean;
      results: Array<{ isSuccess: boolean }>;
    };
    expect(body.isSuccess).toBe(true);
    expect(body.results[0]?.isSuccess).toBe(true);

    const rows = await selectMany(db, tenantTable, { id: tenantAdmin.tenantId });
    expect(rows[0]?.["status"]).toBe("active");
  });
});
