// A destroyHeld tenant keeps the files its held rows point at (fileRef row + bytes) and its retention
// configuration until the retention cleanup has removed the last held row and released the tenant.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createImageField,
  createSystemUser,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  buildStorageKey,
  createInMemoryFileProvider,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
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
  runRetentionCleanup,
  tenantRetentionOverrideEntity,
  tenantRetentionOverrideTable,
} from "../../data-retention/index.ts";
import { resolveTenantRetentionPreset } from "../../data-retention/resolve-tenant-preset.ts";
import { createFilesFeature } from "../../files/index.ts";
import { createFilesTenantDataFeature } from "../../files-tenant-data/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { userSessionTable } from "../../sessions/schema/user-session.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/index.ts";
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createUserFeature } from "../../user/feature.ts";
import { createTenantLifecycleFeature, TenantLifecycleHandlers } from "../index.ts";
import { resetTenantLifecycleGateCacheForTests } from "../lifecycle-gate.ts";

const SWEEP_JOB = "tenant-lifecycle:job:run-tenant-destruction";
const RETENTION_JOB = "data-retention:job:retention-cleanup";
const SET_PROFILE = "compliance-profiles:write:set-profile";
const CREATE_LEDGER = "hold-files-fixtures:write:ledger-create";
const CREATE_CONTRACT = "hold-files-fixtures:write:contract-create";
const tenantAdmin = TestUsers.admin;
const tenantId = tenantAdmin.tenantId;

const ledgerEntity = createEntity({
  table: "read_hold_files_ledger",
  fields: {
    amount: createTextField({ personal: false, reason: "is_business_data", required: true }),
    receipt: createImageField(),
  },
  retention: { keepFor: "1y", strategy: "blockDelete" },
});
// No entity-level retention: it is held only through a per-tenant override.
const contractEntity = createEntity({
  table: "read_hold_files_contract",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});
const ledgerTable = buildEntityTable("ledger", ledgerEntity);
const contractTable = buildEntityTable("contract", contractEntity);
const ledgerCrud = createEventStoreExecutor(ledgerTable, ledgerEntity, { entityName: "ledger" });
const contractCrud = createEventStoreExecutor(contractTable, contractEntity, {
  entityName: "contract",
});
const fileRefCrud = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});
const overrideCrud = createEventStoreExecutor(
  tenantRetentionOverrideTable,
  tenantRetentionOverrideEntity,
  { entityName: "tenant-retention-override" },
);

const holdFixturesFeature = defineFeature("hold-files-fixtures", (r) => {
  r.requires({ features: ["tenant-lifecycle"] });
  r.entity({ name: "ledger", ...ledgerEntity });
  r.entity({ name: "contract", ...contractEntity });
  r.writeHandler({
    name: "ledger-create",
    schema: z.object({ amount: z.string(), receipt: z.string() }),
    access: { roles: access.authenticated },
    description: "test-only ledger row creation",
    handler: async (event, ctx) => ledgerCrud.create(event.payload, event.user, ctx.db),
  });
  r.writeHandler({
    name: "contract-create",
    schema: z.object({ title: z.string() }),
    access: { roles: access.authenticated },
    description: "test-only contract row creation",
    handler: async (event, ctx) => contractCrud.create(event.payload, event.user, ctx.db),
  });
});

const clockStart = getTemporal().Now.instant();
const clock = createManualClock(clockStart);
const provider = createInMemoryFileProvider();
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
      createFilesFeature(),
      createTenantLifecycleFeature(),
      createFilesTenantDataFeature(),
      holdFixturesFeature,
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
      clock,
    },
    files: { storageProvider: provider },
    jobs: { consumerLane: "worker" },
  });
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, fileRefEntity);
  await unsafeCreateEntityTable(stack.db, ledgerEntity, "ledger");
  await unsafeCreateEntityTable(stack.db, contractEntity, "contract");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  clock.set(clockStart);
  provider.clear();
  resetTenantLifecycleGateCacheForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  await resetTestTables(stack.db, [
    tenantTable,
    tenantComplianceProfileTable,
    tenantRetentionOverrideTable,
    userSessionTable,
    tenantMembershipsTable,
    ledgerTable,
    contractTable,
    fileRefsTable,
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

const systemTdb = () =>
  createTenantDb({
    db: stack.db,
    tenantId,
    mode: "system",
    reason: "test seeds rows of the tenant under test",
  });

async function seedFile(name: string): Promise<{ id: string; storageKey: string }> {
  const storageKey = buildStorageKey(tenantId, "fileRef", 1, "receipt", `${name}.jpg`, name);
  await provider.write(storageKey, new Uint8Array([1, 2, 3]), "image/jpeg");
  const result = await fileRefCrud.create(
    { storageKey, fileName: `${name}.jpg`, mimeType: "image/jpeg", size: 3 },
    createSystemUser(tenantId),
    systemTdb(),
  );
  if (!result.isSuccess) throw new Error(`seed fileRef failed: ${result.error.message}`);
  return { id: String(result.data.id), storageKey };
}

async function seedLedgerWithReceipt(): Promise<{ id: string; storageKey: string }> {
  const receipt = await seedFile("receipt");
  await stack.http.writeOk(CREATE_LEDGER, { amount: "100", receipt: receipt.id }, tenantAdmin);
  return receipt;
}

async function tenantStatus(): Promise<string> {
  const [row] = await selectMany<{ status: string }>(stack.db, tenantTable, { id: tenantId });
  return String(row?.status);
}

async function dispatchJob(job: string): Promise<void> {
  await stack.jobRunner?.dispatch(job, {});
  await stack.drainJobs();
}

async function sweepUntilRest(): Promise<string> {
  let status = "";
  for (let tick = 0; tick < 25; tick++) {
    await dispatchJob(SWEEP_JOB);
    status = await tenantStatus();
    if (["destroyed", "destroyHeld", "destroyFailed"].includes(status)) break;
  }
  return status;
}

async function requestDestructionAndWaitOutGrace(): Promise<void> {
  await stack.http.writeOk(TenantLifecycleHandlers.requestDestruction, {}, tenantAdmin);
  clock.advance({ hours: 24 * 40 });
}

async function fileRefIds(): Promise<readonly string[]> {
  const rows = await selectMany<{ id: string }>(stack.db, fileRefsTable, { tenantId });
  return rows.map((row) => row.id);
}

async function tenantEventCount(): Promise<number> {
  return (await selectMany(stack.db, eventsTable, { aggregateId: tenantId })).length;
}

describe("tenant-lifecycle :: destroyHeld keeps the files of held rows", () => {
  test("held file stays with row and bytes, an unreferenced file is wiped, both go after keepFor and the tenant ends destroyed", async () => {
    await seedTenant();
    const receipt = await seedLedgerWithReceipt();
    const loose = await seedFile("loose");
    await requestDestructionAndWaitOutGrace();

    expect(await sweepUntilRest()).toBe("destroyHeld");

    expect(await fileRefIds()).toEqual([receipt.id]);
    expect(await provider.exists(receipt.storageKey)).toBe(true);
    expect(await provider.exists(loose.storageKey)).toBe(false);

    clock.advance({ hours: 24 * 400 });
    await dispatchJob(RETENTION_JOB);

    expect(await fileRefIds()).toEqual([]);
    expect(await provider.exists(receipt.storageKey)).toBe(false);
    // The scheduled sweep may already have finished the destruction while the job queue drained.
    expect(["destroying", "destroyed"]).toContain(await tenantStatus());

    expect(await sweepUntilRest()).toBe("destroyed");
  });

  test("a parked tenant is not sweep work: the sweep appends nothing to its stream, and retention before keepFor keeps it parked", async () => {
    await seedTenant();
    await seedLedgerWithReceipt();
    await requestDestructionAndWaitOutGrace();
    expect(await sweepUntilRest()).toBe("destroyHeld");
    const eventsWhileParked = await tenantEventCount();

    await dispatchJob(SWEEP_JOB);
    await dispatchJob(RETENTION_JOB);
    await dispatchJob(SWEEP_JOB);

    expect(await tenantEventCount()).toBe(eventsWhileParked);
    expect(await tenantStatus()).toBe("destroyHeld");
  });

  test("retention cleanup without any file storage still removes the held row and its fileRef", async () => {
    await seedTenant();
    const receipt = await seedLedgerWithReceipt();
    await requestDestructionAndWaitOutGrace();
    expect(await sweepUntilRest()).toBe("destroyHeld");

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId,
      preloadedTenantPreset: await resolveTenantRetentionPreset({
        db: stack.db,
        registry: stack.registry,
        tenantId,
      }),
      now: clock.now().add({ hours: 24 * 400 }),
      purgeExpiredBlockDelete: true,
    });

    expect(result.skipped).toEqual([]);
    expect(await fileRefIds()).toEqual([]);
    expect(await provider.exists(receipt.storageKey)).toBe(true);
  });
});

describe("tenant-lifecycle :: retention configuration outlives the hold", () => {
  test("an override that makes an entity blockDelete holds the tenant and is erased only with the tombstone, together with the compliance profile", async () => {
    await seedTenant();
    const created = await overrideCrud.create(
      {
        entityName: "contract",
        config: JSON.stringify({ keepFor: "1y", strategy: "blockDelete" }),
        reason: "test legal hold",
      },
      createSystemUser(tenantId),
      systemTdb(),
    );
    expect(created.isSuccess).toBe(true);
    await stack.http.writeOk(CREATE_CONTRACT, { title: "Lease" }, tenantAdmin);
    await requestDestructionAndWaitOutGrace();

    expect(await sweepUntilRest()).toBe("destroyHeld");
    expect(await selectMany(stack.db, tenantRetentionOverrideTable, { tenantId })).toHaveLength(1);
    expect(await selectMany(stack.db, tenantComplianceProfileTable, { tenantId })).toHaveLength(1);
    expect(await selectMany(stack.db, contractTable, { tenantId })).toHaveLength(1);

    clock.advance({ hours: 24 * 400 });
    await dispatchJob(RETENTION_JOB);
    expect(await tenantStatus()).toBe("destroying");
    expect(await selectMany(stack.db, tenantRetentionOverrideTable, { tenantId })).toHaveLength(1);

    expect(await sweepUntilRest()).toBe("destroyed");
    expect(await selectMany(stack.db, tenantRetentionOverrideTable, { tenantId })).toHaveLength(0);
    expect(await selectMany(stack.db, tenantComplianceProfileTable, { tenantId })).toHaveLength(0);
  });
});
