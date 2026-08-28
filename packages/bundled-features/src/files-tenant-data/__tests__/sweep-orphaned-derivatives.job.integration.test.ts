// Backfill/GC job coverage (#2474): sweeps derivative-shaped storage keys
// with no owning fileRef row, for tenants forgotten/destroyed before #2461
// wired binary cleanup into forget/tenant-destroy. Manual job (not perTenant,
// not fanned-out) — called directly with a hand-built JobContext, same
// pattern as jobs/__tests__/reindex-entity-job.integration.test.ts, since
// setupTestStack's jobRunner has nothing extra to wire for a plain manual job.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { JobContext, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
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
  bridgeStub,
  createTestEnvelopeCipher,
  resetTestTables,
} from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createFilesFeature } from "../../files";
import { TenantHandlers } from "../../tenant/constants";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { sweepOrphanedDerivativesJob } from "../handlers/sweep-orphaned-derivatives.job";

const fileRefCrud = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

let stack: TestStack;
let provider: InMemoryFileProvider;

const noopLogger: JobContext["log"] = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger;
  },
};

const tenantA = TestUsers.admin;
const tenantB = TestUsers.otherTenant;

function makeCtx(
  fileProviderResolver?: JobContext["_fileProviderResolver"],
  log: JobContext["log"] = noopLogger,
): JobContext {
  return {
    db: stack.db,
    registry: stack.registry,
    systemUser: tenantA,
    log,
    triggeredBy: null,
    ...(fileProviderResolver ? { _fileProviderResolver: fileProviderResolver } : {}),
    ...bridgeStub(),
  };
}

function makeCapturingLogger(): { log: JobContext["log"]; infoLines: string[] } {
  const infoLines: string[] = [];
  const log: JobContext["log"] = {
    info(message: string) {
      infoLines.push(message);
    },
    warn() {},
    error() {},
    debug() {},
    child() {
      return log;
    },
  };
  return { log, infoLines };
}

async function seedFileRef(tenantId: TenantId, storageKey: string): Promise<void> {
  const user = TestUsers.systemAdmin;
  const tdb = createTenantDb(stack.db, tenantId, "system");
  const result = await fileRefCrud.create(
    { storageKey, fileName: "photo.jpg", mimeType: "image/jpeg", size: 10 },
    { ...user, tenantId },
    tdb,
  );
  if (!result.isSuccess) throw new Error(`seed failed: ${result.error.message}`);
}

async function seedTenant(user: typeof tenantA): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: user.tenantId, key: `t-${user.tenantId}`, name: "Tenant" },
    TestUsers.systemAdmin,
  );
}

function derivativeOf(originalKey: string): string {
  const lastDot = originalKey.lastIndexOf(".");
  return `${originalKey.slice(0, lastDot)}.thumb-0123456789abcdef${originalKey.slice(lastDot)}`;
}

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [createConfigFeature(), createTenantFeature(), createFilesFeature()],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    files: { storageProvider: provider },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, fileRefEntity);
  await createEventsTable(stack.db);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.clear();
  await resetTestTables(stack.db, [tenantTable]);
  await stack.db.unsafe?.(`TRUNCATE kumiko_events, file_refs RESTART IDENTITY CASCADE`);
});

describe("sweepOrphanedDerivativesJob", () => {
  test("deletes a derivative with no owning fileRef row (orphan)", async () => {
    await seedTenant(tenantA);
    const original = buildStorageKey(tenantA.tenantId, "fileRef", 1, "attachment", "a.jpg", "u1");
    const orphan = derivativeOf(original);
    await provider.write(orphan, new Uint8Array([1]));
    // No fileRef row seeded for `original` — the derivative has no owner.

    await sweepOrphanedDerivativesJob(
      {},
      makeCtx(async () => provider),
    );

    expect(await provider.exists(orphan)).toBe(false);
  });

  test("keeps a derivative whose original fileRef row still exists", async () => {
    await seedTenant(tenantA);
    const original = buildStorageKey(tenantA.tenantId, "fileRef", 1, "attachment", "a.jpg", "u1");
    const derivative = derivativeOf(original);
    await seedFileRef(tenantA.tenantId, original);
    await provider.write(original, new Uint8Array([1]));
    await provider.write(derivative, new Uint8Array([2]));

    await sweepOrphanedDerivativesJob(
      {},
      makeCtx(async () => provider),
    );

    expect(await provider.exists(derivative)).toBe(true);
    expect(await provider.exists(original)).toBe(true);
  });

  test("keeps a derivative whose original fileRef row is soft-deleted (trashed, not forgotten)", async () => {
    await seedTenant(tenantA);
    const original = buildStorageKey(tenantA.tenantId, "fileRef", 1, "attachment", "a.jpg", "u1");
    const derivative = derivativeOf(original);
    await seedFileRef(tenantA.tenantId, original);
    await provider.write(derivative, new Uint8Array([2]));

    const rows = await selectMany<{ id: string }>(
      stack.db,
      fileRefsTable,
      { tenantId: tenantA.tenantId },
      { limit: 1 },
    );
    const rowId = rows[0]?.id;
    expect(rowId).toBeDefined();
    const tdb = createTenantDb(stack.db, tenantA.tenantId, "system");
    if (rowId) {
      const deleteResult = await fileRefCrud.delete({ id: rowId }, TestUsers.systemAdmin, tdb);
      expect(deleteResult.isSuccess).toBe(true);
    }

    await sweepOrphanedDerivativesJob(
      {},
      makeCtx(async () => provider),
    );

    // A trashed (soft-deleted) row still legitimately backs its derivatives —
    // only an ABSENT row makes a derivative orphaned.
    expect(await provider.exists(derivative)).toBe(true);
  });

  test("dryRun: true reports without deleting anything", async () => {
    await seedTenant(tenantA);
    const original = buildStorageKey(tenantA.tenantId, "fileRef", 1, "attachment", "a.jpg", "u1");
    const orphan = derivativeOf(original);
    await provider.write(orphan, new Uint8Array([1]));
    const { log, infoLines } = makeCapturingLogger();

    await sweepOrphanedDerivativesJob(
      { dryRun: true },
      makeCtx(async () => provider, log),
    );

    // Existence alone can't distinguish "correctly found and would delete the
    // orphan" from "found nothing" — both leave the key in place. Assert the
    // sweep actually counted the candidate.
    expect(infoLines.some((line) => line.includes("wouldDelete=1"))).toBe(true);
    expect(await provider.exists(orphan)).toBe(true);
  });

  test("pages across multiple tenants and only sweeps each tenant's own orphans", async () => {
    await seedTenant(tenantA);
    await seedTenant(tenantB);

    const originalA = buildStorageKey(tenantA.tenantId, "fileRef", 1, "attachment", "a.jpg", "u1");
    const orphanA = derivativeOf(originalA);
    await provider.write(orphanA, new Uint8Array([1]));

    const originalB = buildStorageKey(tenantB.tenantId, "fileRef", 1, "attachment", "b.jpg", "u2");
    const derivativeB = derivativeOf(originalB);
    await seedFileRef(tenantB.tenantId, originalB);
    await provider.write(originalB, new Uint8Array([2]));
    await provider.write(derivativeB, new Uint8Array([3]));

    await sweepOrphanedDerivativesJob(
      {},
      makeCtx(async () => provider),
    );

    expect(await provider.exists(orphanA)).toBe(false);
    expect(await provider.exists(derivativeB)).toBe(true);
    expect(await provider.exists(originalB)).toBe(true);
  });

  test("no _fileProviderResolver wired: skips the run entirely, no throw", async () => {
    await seedTenant(tenantA);
    const original = buildStorageKey(tenantA.tenantId, "fileRef", 1, "attachment", "a.jpg", "u1");
    const orphan = derivativeOf(original);
    await provider.write(orphan, new Uint8Array([1]));

    await expect(sweepOrphanedDerivativesJob({}, makeCtx())).resolves.toBeUndefined();

    expect(await provider.exists(orphan)).toBe(true);
  });

  test("a non-derivative-shaped key (the original itself) is never touched", async () => {
    await seedTenant(tenantA);
    const original = buildStorageKey(tenantA.tenantId, "fileRef", 1, "attachment", "a.jpg", "u1");
    await provider.write(original, new Uint8Array([1]));
    // No fileRef row seeded — if parseDerivativeKey ever mis-parsed a plain
    // original as derivative-shaped, this would wrongly delete it.

    await sweepOrphanedDerivativesJob(
      {},
      makeCtx(async () => provider),
    );

    expect(await provider.exists(original)).toBe(true);
  });
});
