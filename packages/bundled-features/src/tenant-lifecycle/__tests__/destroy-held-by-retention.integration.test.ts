// blockDelete rows still inside keepFor outlive the tenant destruction: the sweep anonymizes them,
// parks the tenant in destroyHeld (account stays locked) and only tombstones it once the
// retention cleanup has removed the last held row.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  buildEntityTable,
  createEventStoreExecutor,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  EXT_TENANT_DATA,
  type TenantDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createManualClock,
  createTestEnvelopeCipher,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import {
  createDataRetentionFeature,
  holdBlockDeleteRowsForDestruction,
  tenantHasBlockDeleteRows,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { userSessionTable } from "../../sessions/schema/user-session.ts";
import { decryptStoredPii } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/index.ts";
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers, TenantQueries } from "../../tenant/web/constants.ts";
import { createUserFeature } from "../../user/feature.ts";
import {
  TENANT_DESTRUCTION_FAILED_EVENT_QN,
  TENANT_DESTRUCTION_STAGE_FAILED_EVENT_QN,
} from "../constants.ts";
import { createTenantLifecycleFeature, TenantLifecycleHandlers } from "../index.ts";
import { resetTenantLifecycleGateCacheForTests } from "../lifecycle-gate.ts";

const SWEEP_JOB = "tenant-lifecycle:job:run-tenant-destruction";
const RETENTION_JOB = "data-retention:job:retention-cleanup";
const SET_PROFILE = "compliance-profiles:write:set-profile";
const CREATE_LEDGER = "hold-fixtures:write:ledger-create";
const CREATE_SCRATCH = "hold-fixtures:write:scratch-create";
const HOLDER_NAME = "Erika Mustermann";
const tenantAdmin = TestUsers.admin;
const tenantId = tenantAdmin.tenantId;

const ledgerEntity = createEntity({
  table: "read_hold_ledger",
  fields: {
    holder: createTextField({
      personal: "tenant",
      find: "none",
      default: "",
      anonymize: () => "[ANONYMIZED]",
    }),
    amount: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
  retention: { keepFor: "1y", strategy: "blockDelete" },
});
const scratchEntity = createEntity({
  table: "read_hold_scratch",
  fields: {
    label: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});
const ledgerTable = buildEntityTable("ledger", ledgerEntity);
const scratchTable = buildEntityTable("scratch", scratchEntity);
const ledgerCrud = createEventStoreExecutor(ledgerTable, ledgerEntity, { entityName: "ledger" });
const scratchCrud = createEventStoreExecutor(scratchTable, scratchEntity, {
  entityName: "scratch",
});

async function forgetAllLedgerRows(ctx: TenantDataHookCtx): Promise<void> {
  const rows = await ctx.db.selectMany<{ id: string }>(ledgerTable, { tenantId: ctx.tenantId });
  for (const row of rows) {
    await ledgerCrud.forget({ id: row.id }, createSystemUser(ctx.tenantId), ctx.db);
  }
}

async function forgetAllScratchRows(ctx: TenantDataHookCtx): Promise<void> {
  const rows = await ctx.db.selectMany<{ id: string }>(scratchTable, { tenantId: ctx.tenantId });
  for (const row of rows) {
    await scratchCrud.forget({ id: row.id }, createSystemUser(ctx.tenantId), ctx.db);
  }
}

const holdFixturesFeature = defineFeature("hold-fixtures", (r) => {
  r.requires({ features: ["tenant-lifecycle"] });
  r.entity({ name: "ledger", ...ledgerEntity });
  r.entity({ name: "scratch", ...scratchEntity });
  r.writeHandler({
    name: "ledger-create",
    schema: z.object({ holder: z.string(), amount: z.string() }),
    access: { roles: access.authenticated },
    description: "test-only ledger row creation",
    handler: async (event, ctx) => ledgerCrud.create(event.payload, event.user, ctx.db),
  });
  r.writeHandler({
    name: "scratch-create",
    schema: z.object({ label: z.string() }),
    access: { roles: access.authenticated },
    description: "test-only scratch row creation",
    handler: async (event, ctx) => scratchCrud.create(event.payload, event.user, ctx.db),
  });
  r.useExtension(EXT_TENANT_DATA, "ledger", {
    destroy: forgetAllLedgerRows,
  });
  r.useExtension(EXT_TENANT_DATA, "scratch", {
    destroy: forgetAllScratchRows,
  });
});

const clockStart = getTemporal().Now.instant();
const clock = createManualClock(clockStart);
let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createTenantLifecycleFeature(),
      holdFixturesFeature,
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
      clock,
    },
    jobs: { consumerLane: "worker" },
  });
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, ledgerEntity, "ledger");
  await unsafeCreateEntityTable(stack.db, scratchEntity, "scratch");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  clock.set(clockStart);
  resetTenantLifecycleGateCacheForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  await resetTestTables(stack.db, [
    tenantTable,
    tenantComplianceProfileTable,
    userSessionTable,
    tenantMembershipsTable,
    ledgerTable,
    scratchTable,
    eventsTable,
  ]);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function seedTenant(): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: tenantId, key: "acme", name: "ACME Corp" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantAdmin);
}

async function tenantStatus(): Promise<string> {
  const [row] = await selectMany<{ status: string }>(stack.db, tenantTable, { id: tenantId });
  return String(row?.status);
}

async function dispatchJob(job: string): Promise<void> {
  await stack.jobRunner?.dispatch(job, {});
  await stack.drainJobs();
}

// Sweeps until the tenant reaches a resting status; returns every status seen on the way.
async function sweepUntilRest(): Promise<readonly string[]> {
  const seen: string[] = [];
  for (let tick = 0; tick < 25; tick++) {
    await dispatchJob(SWEEP_JOB);
    const status = await tenantStatus();
    seen.push(status);
    if (["destroyed", "destroyHeld", "destroyFailed"].includes(status)) break;
  }
  return seen;
}

async function requestDestructionAndWaitOutGrace(): Promise<void> {
  await stack.http.writeOk(TenantLifecycleHandlers.requestDestruction, {}, tenantAdmin);
  clock.advance({ hours: 24 * 40 });
}

async function ledgerRows(): Promise<readonly { id: string; holder: string; amount: string }[]> {
  return await selectMany<{ id: string; holder: string; amount: string }>(stack.db, ledgerTable, {
    tenantId,
  });
}

async function scratchRowCount(): Promise<number> {
  return (await selectMany(stack.db, scratchTable, { tenantId })).length;
}

async function failureEventCount(): Promise<number> {
  const events = await selectMany<{ type: string }>(stack.db, eventsTable, {
    aggregateId: tenantId,
  });
  return events.filter(
    (e) =>
      e.type === TENANT_DESTRUCTION_FAILED_EVENT_QN ||
      e.type === TENANT_DESTRUCTION_STAGE_FAILED_EVENT_QN,
  ).length;
}

describe("tenant-lifecycle :: destruction held by blockDelete retention", () => {
  test("a ledger row inside keepFor parks the tenant in destroyHeld: row kept, person anonymized, account locked", async () => {
    await seedTenant();
    await stack.http.writeOk(CREATE_LEDGER, { holder: HOLDER_NAME, amount: "100" }, tenantAdmin);
    await stack.http.writeOk(CREATE_SCRATCH, { label: "temp" }, tenantAdmin);
    const [before] = await ledgerRows();
    expect(await decryptStoredPii(String(before?.holder), "holder", "test")).toBe(HOLDER_NAME);

    await requestDestructionAndWaitOutGrace();
    const seen = await sweepUntilRest();

    expect(seen.at(-1)).toBe("destroyHeld");
    const rows = await ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe("100");
    expect(rows[0]?.holder).not.toBe(before?.holder);
    // subject-keys erased the tenant key, so the anonymized (encrypted) holder reads back as the sentinel.
    expect(await decryptStoredPii(String(rows[0]?.holder), "holder", "test")).toBe(
      PII_ERASED_SENTINEL,
    );
    expect(await scratchRowCount()).toBe(0);
    expect((await stack.http.query(TenantQueries.me, {}, tenantAdmin)).status).toBe(410);
    expect(await failureEventCount()).toBe(0);

    const cancel = await stack.http.batch(
      [{ type: TenantLifecycleHandlers.cancelDestruction, payload: {} }],
      tenantAdmin,
    );
    const cancelBody = (await cancel.json()) as { isSuccess?: boolean };
    expect(cancelBody.isSuccess).not.toBe(true);
    expect(await tenantStatus()).toBe("destroyHeld");

    await dispatchJob(SWEEP_JOB);
    expect(await tenantStatus()).toBe("destroyHeld");
  });

  test("after keepFor the retention cleanup removes the row, then the tenant is released and tombstoned without a failure", async () => {
    await seedTenant();
    await stack.http.writeOk(CREATE_LEDGER, { holder: HOLDER_NAME, amount: "100" }, tenantAdmin);
    await requestDestructionAndWaitOutGrace();
    expect((await sweepUntilRest()).at(-1)).toBe("destroyHeld");

    clock.advance({ hours: 24 * 400 });
    await dispatchJob(RETENTION_JOB);
    expect(await ledgerRows()).toHaveLength(0);

    const seen = await sweepUntilRest();
    expect(seen.at(-1)).toBe("destroyed");
    expect(await failureEventCount()).toBe(0);
  });

  test("retention cleanup keeps an unexpired held row of a still-held tenant", async () => {
    await seedTenant();
    await stack.http.writeOk(CREATE_LEDGER, { holder: HOLDER_NAME, amount: "100" }, tenantAdmin);
    await requestDestructionAndWaitOutGrace();
    expect((await sweepUntilRest()).at(-1)).toBe("destroyHeld");

    await dispatchJob(RETENTION_JOB);
    await dispatchJob(SWEEP_JOB);

    expect(await ledgerRows()).toHaveLength(1);
    expect(await tenantStatus()).toBe("destroyHeld");
  });

  test("a tenant without held rows is destroyed in one pass and never parked", async () => {
    await seedTenant();
    await stack.http.writeOk(CREATE_SCRATCH, { label: "temp" }, tenantAdmin);
    await requestDestructionAndWaitOutGrace();

    const seen = await sweepUntilRest();

    expect(seen.at(-1)).toBe("destroyed");
    expect(seen).not.toContain("destroyHeld");
    expect(await scratchRowCount()).toBe(0);
    expect(await failureEventCount()).toBe(0);
  });
});

describe("data-retention :: holdBlockDeleteRowsForDestruction", () => {
  test("anonymizes held rows once: a repeated call appends no further events", async () => {
    await seedTenant();
    await stack.http.writeOk(CREATE_LEDGER, { holder: HOLDER_NAME, amount: "100" }, tenantAdmin);
    const args = { db: stack.db, registry: stack.registry, tenantId, now: clock.now() };
    expect(await tenantHasBlockDeleteRows(args)).toBe(true);

    const held = await holdBlockDeleteRowsForDestruction(args);
    expect([...held.entityNames]).toEqual(["ledger"]);
    const [row] = await ledgerRows();
    expect(await decryptStoredPii(String(row?.holder), "holder", "test")).toBe("[ANONYMIZED]");
    const eventsAfterFirst = (await selectMany(stack.db, eventsTable, { aggregateId: row?.id }))
      .length;

    await holdBlockDeleteRowsForDestruction(args);

    expect((await selectMany(stack.db, eventsTable, { aggregateId: row?.id })).length).toBe(
      eventsAfterFirst,
    );
  });

  test("reports nothing held once the row is past keepFor", async () => {
    await seedTenant();
    await stack.http.writeOk(CREATE_LEDGER, { holder: HOLDER_NAME, amount: "100" }, tenantAdmin);

    const held = await holdBlockDeleteRowsForDestruction({
      db: stack.db,
      registry: stack.registry,
      tenantId,
      now: clock.now().add({ hours: 24 * 400 }),
    });

    expect(held.entityNames.size).toBe(0);
  });
});
