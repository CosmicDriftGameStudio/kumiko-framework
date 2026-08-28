// files-tenant-data — EXT_TENANT_DATA (fileRef row purge) + EXT_STORAGE_PROVIDER
// (full tenant storage-prefix wipe) coverage for tenant-destroy (#2474).
//
// Seeds the "destroying" tenant state directly (status update + a
// TENANT_DESTRUCTION_STARTED_EVENT_QN append) instead of going through the
// `request-destruction` write handler — same pattern as tenant-lifecycle's
// own "pipeline abandon / destroyFailed" describe block, which sidesteps that
// handler's user/auth/sessions feature requirements entirely.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  append,
  createEventsTable,
  loadAggregate,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  buildStorageKey,
  createInMemoryFileProvider,
  fileRefEntity,
  fileRefsTable,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
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
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createFilesFeature } from "../../files";
import { tenantMembershipEntity } from "../../tenant";
import { TenantHandlers } from "../../tenant/constants";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import {
  TENANT_AGGREGATE_TYPE,
  TENANT_DESTRUCTION_STARTED_EVENT_QN,
} from "../../tenant-lifecycle/constants";
import { runTenantDestructionSweep } from "../../tenant-lifecycle/run-tenant-destroy";
import { sweepOrphanedDerivativesJob } from "../handlers/sweep-orphaned-derivatives.job";
import { createFilesTenantDataFeature } from "../index";

const SET_PROFILE = "compliance-profiles:write:set-profile";
const SWEEP_JOB = "files-tenant-data:job:sweep-orphaned-derivatives";

const fileRefCrud = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

let stack: TestStack;
let db: DbConnection;
let provider: InMemoryFileProvider;

const tenantA = TestUsers.admin;
const tenantB = TestUsers.otherTenant;

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createFilesFeature(),
      createFilesTenantDataFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    files: { storageProvider: provider },
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, tenantMembershipEntity);
  await unsafeCreateEntityTable(db, fileRefEntity);
  await createEventsTable(db);
  await unsafePushTables(db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  stack.events.reset();
  provider.clear();
  await resetTestTables(db, [tenantTable, tenantComplianceProfileTable]);
  await stack.db.unsafe?.(`TRUNCATE kumiko_events, file_refs RESTART IDENTITY CASCADE`);
});

async function seedTenant(user: typeof tenantA): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: user.tenantId, key: `t-${user.tenantId}`, name: "Tenant" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, user);
}

async function seedFileRef(tenantId: TenantId, storageKey: string) {
  const user = createSystemUser(tenantId);
  const tdb = createTenantDb(db, tenantId, "system");
  const result = await fileRefCrud.create(
    { storageKey, fileName: "photo.jpg", mimeType: "image/jpeg", size: 10 },
    user,
    tdb,
  );
  if (!result.isSuccess) throw new Error(`seed failed: ${result.error.message}`);
  return { id: result.data.id };
}

// Sidesteps the `request-destruction` write handler (needs user/auth/sessions
// features wired) by seeding the same "destroying" state it would produce —
// same pattern as tenant-lifecycle's own poison-pill destroy tests.
async function seedDestroyingTenant(tenantId: TenantId): Promise<void> {
  const now = getTemporal().Now.instant();
  await updateRows(
    db,
    tenantTable,
    { status: "destroying", destroyStartedAt: now },
    { id: tenantId },
  );
  await append(db, {
    aggregateId: tenantId,
    aggregateType: TENANT_AGGREGATE_TYPE,
    tenantId,
    expectedVersion: (await loadAggregate(db, tenantId, tenantId)).at(-1)?.version ?? 0,
    type: TENANT_DESTRUCTION_STARTED_EVENT_QN,
    payload: { startedAt: now.toString() },
    metadata: { userId: "system", requestId: "test:destruction-started" },
  });
}

async function driveDestructionToCompletion(
  tenantId: TenantId,
  fileProviderResolver?: (tenantId: TenantId) => Promise<InMemoryFileProvider>,
): Promise<string> {
  const farFuture = getTemporal()
    .Now.instant()
    .add({ hours: 24 * 3650 });
  let status = "";
  for (let i = 0; i < 20; i++) {
    await runTenantDestructionSweep({
      db: stack.db,
      registry: stack.registry,
      now: farFuture,
      ...(fileProviderResolver ? { fileProviderResolver } : {}),
    });
    const rows = await selectMany(db, tenantTable, { id: tenantId });
    status = String(rows[0]?.["status"]);
    if (status === "destroyed" || status === "destroyFailed") break;
  }
  return status;
}

describe("files-tenant-data :: job registration", () => {
  test("registers sweepOrphanedDerivativesJob as files-tenant-data:job:sweep-orphaned-derivatives — the name jobs:write:trigger dispatches by", () => {
    const job = stack.registry.getJob(SWEEP_JOB);
    expect(job).toBeDefined();
    expect(job?.handler).toBe(sweepOrphanedDerivativesJob);
    expect(job?.trigger).toEqual({ manual: true });
  });
});

describe("files-tenant-data :: tenant destroy", () => {
  test("purges fileRef rows and wipes every storage key under the tenant prefix, leaving other tenants untouched", async () => {
    await seedTenant(tenantA);
    await seedTenant(tenantB);

    const originalKeyA = buildStorageKey(
      tenantA.tenantId,
      "fileRef",
      1,
      "attachment",
      "photo.jpg",
      "u1",
    );
    const derivativeKeyA = `${originalKeyA.replace(/\.jpg$/, "")}.thumb-0123456789abcdef.jpg`;
    const unrelatedKeyA = `${tenantA.tenantId}/some-other-file.bin`;
    const { id: fileRefIdA } = await seedFileRef(tenantA.tenantId, originalKeyA);
    await provider.write(originalKeyA, new Uint8Array([1]));
    await provider.write(derivativeKeyA, new Uint8Array([2]));
    await provider.write(unrelatedKeyA, new Uint8Array([3]));

    const originalKeyB = buildStorageKey(
      tenantB.tenantId,
      "fileRef",
      1,
      "attachment",
      "photo.jpg",
      "u2",
    );
    await seedFileRef(tenantB.tenantId, originalKeyB);
    await provider.write(originalKeyB, new Uint8Array([4]));

    await seedDestroyingTenant(tenantA.tenantId);

    const finalStatus = await driveDestructionToCompletion(tenantA.tenantId, async () => provider);
    expect(finalStatus).toBe("destroyed");

    // Row purge (EXT_TENANT_DATA "app-data" stage) — hard-purged via forget(),
    // not just soft-deleted, so a plain selectMany with no isDeleted filter
    // already proves it (a soft-delete would still show the row).
    const rowsA = await selectMany(db, fileRefsTable, { tenantId: tenantA.tenantId });
    expect(rowsA).toHaveLength(0);

    // Storage wipe (EXT_STORAGE_PROVIDER "files" stage) — every key under the
    // tenant's prefix is gone, including the unrelated non-fileRef-tracked key.
    expect(await provider.list(`${tenantA.tenantId}/`)).toHaveLength(0);

    // Tenant B's fileRef row and storage key are completely untouched.
    const rowsB = await selectMany(db, fileRefsTable, { tenantId: tenantB.tenantId });
    expect(rowsB).toHaveLength(1);
    expect(await provider.exists(originalKeyB)).toBe(true);

    // The forgotten row's aggregate carries a `.forgotten` event — proves
    // this went through the executor (rebuild-safe), not a raw deleteMany.
    const events = await loadAggregate(db, String(fileRefIdA), tenantA.tenantId);
    expect(events.some((e) => e.type === "fileRef.forgotten")).toBe(true);
  });

  test("no fileProviderResolver wired: row purge still runs, storage stage no-ops without failing the pipeline", async () => {
    await seedTenant(tenantA);
    const originalKeyA = buildStorageKey(
      tenantA.tenantId,
      "fileRef",
      1,
      "attachment",
      "photo.jpg",
      "u1",
    );
    await seedFileRef(tenantA.tenantId, originalKeyA);
    await provider.write(originalKeyA, new Uint8Array([1]));

    await seedDestroyingTenant(tenantA.tenantId);

    const finalStatus = await driveDestructionToCompletion(tenantA.tenantId);
    expect(finalStatus).toBe("destroyed");

    const rowsA = await selectMany(db, fileRefsTable, { tenantId: tenantA.tenantId });
    expect(rowsA).toHaveLength(0);
    // No resolver was passed — the binary was never asked to be deleted, but
    // that must degrade gracefully (not fail-closed), same as the per-user
    // forget hook's resolution-failure stance.
    expect(await provider.exists(originalKeyA)).toBe(true);
  });
});
