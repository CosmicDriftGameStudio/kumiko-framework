import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  EXT_EXTERNAL_RESOURCE,
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
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createTestEnvelopeCipher,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
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
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant";
import { TenantHandlers, TenantQueries } from "../../tenant/constants";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
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
import { resetTenantLifecycleGateCacheForTests } from "../lifecycle-gate";
import { runNextDestructionStage, runTenantDestructionSweep } from "../run-tenant-destroy";

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
      authFoundationFeature,
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
  await unsafeCreateEntityTable(db, tenantMembershipEntity);
  await createEventsTable(db);
  await unsafePushTables(db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  stack.events.reset();
  // resetTestTables wipes rows via raw SQL, not through the write handlers
  // that invalidate the lifecycle-gate cache — clear it too, or a later test
  // reusing tenantAdmin.tenantId reads an earlier test's cached status.
  resetTenantLifecycleGateCacheForTests();
  await resetTestTables(db, [
    tenantTable,
    tenantComplianceProfileTable,
    userSessionTable,
    tenantMembershipsTable,
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

  test("batch mixing cancel with another command is NOT exempt (410)", async () => {
    await seedTenant();
    await stack.http.writeOk(REQUEST, {}, tenantAdmin);
    const res = await stack.http.batch(
      [
        { type: CANCEL, payload: {} },
        { type: SET_PROFILE, payload: { profileKey: "de-hr-dsgvo-hgb" } },
      ],
      tenantAdmin,
    );
    expect(res.status).toBe(410);

    // Neither command ran — the tenant is still destroyRequested, not
    // cancelled back to active.
    const rows = await selectMany(db, tenantTable, { id: tenantAdmin.tenantId });
    expect(rows[0]?.["status"]).toBe("destroyRequested");
  });
});

describe("tenant-lifecycle :: full sweep pipeline", () => {
  test("runTenantDestructionSweep drives destroyRequested -> destroyed, memberships forgotten", async () => {
    await seedTenant();
    const membership = await seedTenantMembership(db, {
      userId: TestUsers.user.id,
      tenantId: tenantAdmin.tenantId,
      roles: ["User"],
    });
    await stack.http.writeOk(REQUEST, {}, tenantAdmin);

    // Comfortably past any compliance profile's grace period, so the sweep's
    // first loop flips destroyRequested -> destroying on the first tick.
    const farFuture = getTemporal()
      .Now.instant()
      .add({ hours: 24 * 3650 });

    let status = "";
    for (let i = 0; i < 20; i++) {
      await runTenantDestructionSweep({ db: stack.db, registry: stack.registry, now: farFuture });
      const rows = await selectMany(db, tenantTable, { id: tenantAdmin.tenantId });
      status = String(rows[0]?.["status"]);
      if (status === "destroyed" || status === "destroyFailed") break;
    }

    expect(status).toBe("destroyed");

    const memberships = await selectMany(db, tenantMembershipsTable, {
      tenantId: tenantAdmin.tenantId,
    });
    expect(memberships).toHaveLength(0);

    // Discriminates the fix from a raw deleteMany bypass — both empty the
    // projection table, but only forget() through the executor leaves an
    // event on the membership's own aggregate stream (rebuild-safe erasure).
    const membershipEvents = await loadAggregate(db, membership.id, tenantAdmin.tenantId);
    expect(membershipEvents.some((e) => e.type === "tenant-membership.forgotten")).toBe(true);

    // Gate resolves the fresh status too — proves the cache was invalidated
    // through every status transition, not just the final one.
    const gate = await resolveTenantLifecycleGate(stack.db, tenantAdmin.tenantId);
    expect(gate?.status).toBe("destroyed");
  });
});

// One tenantId is set here per-test right before the sweep call — the hook
// throws only for that tenant, letting a single stack exercise "one tenant's
// destroy-hook fails, does that stall every OTHER destroying tenant's sweep
// progress in the same tick?" without a second full stack.
let selectivePoisonTargetTenantId: TenantId | null = null;

function createSelectivePoisonTenantDataFeature() {
  return defineFeature("test-selective-poison-tenant-data", (r) => {
    r.requires("tenant-lifecycle");
    // EXT_EXTERNAL_RESOURCE — the pipeline's FIRST stage — so the poison
    // fires on the very first sweep tick instead of several stages in.
    r.useExtension(EXT_EXTERNAL_RESOURCE, "selective-poison-pill", {
      destroyTenant: async (tenantId: TenantId) => {
        if (tenantId === selectivePoisonTargetTenantId) {
          throw new Error("selective-poison");
        }
      },
    });
  });
}

describe("tenant-lifecycle :: sweep isolates one tenant's failure from another's progress", () => {
  let isolationStack: TestStack;
  const tenantA = tenantAdmin.tenantId; // poisoned
  const tenantB = testTenantId(9002); // healthy

  beforeAll(async () => {
    const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
    const resolver = createConfigResolver({ cipher: encryption });
    isolationStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createTenantFeature(),
        createComplianceProfilesFeature(),
        createTenantLifecycleFeature(),
        createSelectivePoisonTenantDataFeature(),
      ],
      extraContext: { configResolver: resolver, configEncryption: encryption },
    });
    await unsafeCreateEntityTable(isolationStack.db, tenantEntity);
    await unsafeCreateEntityTable(isolationStack.db, tenantComplianceProfileEntity);
    await createEventsTable(isolationStack.db);
    await unsafePushTables(isolationStack.db, { configValuesTable });
  });

  afterAll(async () => {
    await isolationStack.cleanup();
  });

  async function seedDestroyingTenant(id: TenantId): Promise<void> {
    await isolationStack.http.writeOk(
      TenantHandlers.create,
      { id, key: `acme-${id.slice(-4)}`, name: "ACME Corp" },
      TestUsers.systemAdmin,
    );
    await isolationStack.http.writeOk(
      SET_PROFILE,
      { profileKey: "eu-dsgvo" },
      { ...tenantAdmin, tenantId: id },
    );
    await updateRows(isolationStack.db, tenantTable, { status: "destroying" }, { id });
  }

  test("tenant A's poisoned destroy-hook does not block tenant B's sweep progress", async () => {
    selectivePoisonTargetTenantId = tenantA;
    await seedDestroyingTenant(tenantA);
    await seedDestroyingTenant(tenantB);

    const result = await runTenantDestructionSweep({
      db: isolationStack.db,
      registry: isolationStack.registry,
    });

    // A's first stage ("external-resources") throws every attempt — not
    // counted as advanced. B has no poison, so it does advance. If A's
    // failure aborted the sweep loop (the pre-fix behavior), B would never
    // be reached and this would be 0.
    expect(result.advanced).toBe(1);

    const rowB = await selectMany(isolationStack.db, tenantTable, { id: tenantB });
    expect(rowB[0]?.["status"]).toBe("destroying"); // still mid-pipeline, but progressed
    const eventsB = await loadAggregate(isolationStack.db, tenantB, tenantB);
    expect(eventsB.some((e) => e.type.endsWith("tenant-destruction-stage-succeeded"))).toBe(true);
  });
});
