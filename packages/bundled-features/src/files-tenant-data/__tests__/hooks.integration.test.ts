// files-tenant-data — EXT_TENANT_DATA (fileRef row purge) + EXT_STORAGE_PROVIDER
// (full tenant storage-prefix wipe) coverage for tenant-destroy.
//
// Seeds the "destroying" tenant state directly (status update + a
// TENANT_DESTRUCTION_STARTED_EVENT_QN append) instead of going through the
// `request-destruction` write handler — same pattern as tenant-lifecycle's
// own "pipeline abandon / destroyFailed" describe block, which sidesteps that
// handler's user/auth/sessions feature requirements entirely.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEventStoreExecutor,
  createTenantDataDestroyDb,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type EntityId,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { append, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { buildStorageKey, createFilesFeature, createInMemoryFileProvider, fileRefEntity, fileRefsTable, tenantExportPrefix, type InMemoryFileProvider } from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createTestEnvelopeCipher,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipEntity } from "../../tenant/index.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { updateTenantViaEventStore } from "../../tenant/testing.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import {
  TENANT_AGGREGATE_TYPE,
  TENANT_DESTRUCTION_STARTED_EVENT_QN,
} from "../../tenant-lifecycle/constants.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { runTenantDestructionSweep } from "../../tenant-lifecycle/run-tenant-destroy.ts";
import { fileRefStorageDestroyHook, fileRefTenantDestroyHook } from "../hooks.ts";
import { createFilesTenantDataFeature } from "../index.ts";

const SET_PROFILE = "compliance-profiles:write:set-profile";

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
  const tdb = createTenantDb({
    db,
    tenantId,
    mode: "system",
    reason: "test inspects file rows of the destroyed tenant from outside its scope",
  });
  const result = await fileRefCrud.create(
    { storageKey, fileName: "photo.jpg", mimeType: "image/jpeg", size: 10 },
    user,
    tdb,
  );
  if (!result.isSuccess) throw new Error(`seed failed: ${result.error.message}`);
  return { id: result.data.id };
}

// Stands in for a tenant-handover claim: the row's
// tenantId moves, the storageKey — and the bytes behind it — do not.
async function handOverFileRef(fileRefId: EntityId, toTenantId: TenantId): Promise<void> {
  await updateRows(
    db,
    fileRefsTable,
    { tenantId: toTenantId },
    { id: String(fileRefId) },
    { projectionOnly: "stands in for the tenant-handover move, which writes the row directly" },
  );
}

// Sidesteps the `request-destruction` write handler (needs user/auth/sessions
// features wired) by seeding the same "destroying" state it would produce —
// same pattern as tenant-lifecycle's own poison-pill destroy tests.
async function seedDestroyingTenant(tenantId: TenantId): Promise<void> {
  const now = getTemporal().Now.instant();
  await updateTenantViaEventStore(db, tenantId, { status: "destroying", destroyStartedAt: now });
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
    // Export ZIPs live under exports/{tenantId}/, not {tenantId}/ — a
    // regression here would leave a tenant's decrypted GDPR export bundle
    // behind after destroy.
    const exportKeyA = `${tenantExportPrefix(tenantA.tenantId)}job-1.zip`;
    const { id: fileRefIdA } = await seedFileRef(tenantA.tenantId, originalKeyA);
    await provider.write(originalKeyA, new Uint8Array([1]));
    await provider.write(derivativeKeyA, new Uint8Array([2]));
    await provider.write(unrelatedKeyA, new Uint8Array([3]));
    await provider.write(exportKeyA, new Uint8Array([5]));

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
    // The export prefix is a separate top-level sweep, not covered by
    // `${tenantId}/` — proves fileRefStorageDestroyHook sweeps it too.
    expect(await provider.exists(exportKeyA)).toBe(false);

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

  // Tenant-handover leaves a fileRef row's tenantId
  // pointing at a NEW tenant while its storageKey (and the bytes behind it)
  // stay under the tenant that originally uploaded it.
  describe("after a tenant-handover", () => {
    test("the destination tenant's destroy deletes the handed-over binary even though it lives outside its own prefix", async () => {
      await seedTenant(tenantA);
      await seedTenant(tenantB);

      const handedOverKey = buildStorageKey(
        tenantA.tenantId,
        "fileRef",
        1,
        "attachment",
        "photo.jpg",
        "u1",
      );
      const { id: fileRefId } = await seedFileRef(tenantA.tenantId, handedOverKey);
      await provider.write(handedOverKey, new Uint8Array([1]));

      await handOverFileRef(fileRefId, tenantB.tenantId);

      await seedDestroyingTenant(tenantB.tenantId);
      const finalStatus = await driveDestructionToCompletion(
        tenantB.tenantId,
        async () => provider,
      );
      expect(finalStatus).toBe("destroyed");

      const rowsB = await selectMany(db, fileRefsTable, { tenantId: tenantB.tenantId });
      expect(rowsB).toHaveLength(0);
      expect(await provider.exists(handedOverKey)).toBe(false);
    });

    test("deletes the handed-over binary from the SOURCE tenant's provider when storage is per-tenant", async () => {
      await seedTenant(tenantA);
      await seedTenant(tenantB);

      const handedOverKey = buildStorageKey(
        tenantA.tenantId,
        "fileRef",
        1,
        "attachment",
        "photo.jpg",
        "u1",
      );
      const { id: fileRefId } = await seedFileRef(tenantA.tenantId, handedOverKey);
      const providerOfA = createInMemoryFileProvider();
      const providerOfB = createInMemoryFileProvider();
      await providerOfA.write(handedOverKey, new Uint8Array([1]));

      await handOverFileRef(fileRefId, tenantB.tenantId);

      await seedDestroyingTenant(tenantB.tenantId);
      const finalStatus = await driveDestructionToCompletion(tenantB.tenantId, async (tenantId) =>
        tenantId === tenantA.tenantId ? providerOfA : providerOfB,
      );
      expect(finalStatus).toBe("destroyed");

      expect(await providerOfA.exists(handedOverKey)).toBe(false);
    });

    test("the SOURCE tenant's destroy does not delete files — or their derivatives — foreign tenants claimed, but still sweeps orphans and stem-sharing siblings", async () => {
      await seedTenant(tenantA);
      await seedTenant(tenantB);

      const originalKey = buildStorageKey(
        tenantA.tenantId,
        "fileRef",
        1,
        "attachment",
        "photo.jpg",
        "u1",
      );
      const derivativeKey = `${originalKey.replace(/\.jpg$/, "")}.medium.jpg`;
      const secondOriginalKey = buildStorageKey(
        tenantA.tenantId,
        "fileRef",
        1,
        "attachment",
        "scan.jpg",
        "u2",
      );
      const secondDerivativeKey = `${secondOriginalKey.replace(/\.jpg$/, "")}.medium.jpg`;
      // Shares the original's leading characters but not its stem.
      const siblingKey = `${originalKey.replace(/\.jpg$/, "")}-sibling.jpg`;
      const orphanKey = `${tenantA.tenantId}/some-other-file.bin`;
      const { id: fileRefId } = await seedFileRef(tenantA.tenantId, originalKey);
      const { id: secondFileRefId } = await seedFileRef(tenantA.tenantId, secondOriginalKey);
      await provider.write(originalKey, new Uint8Array([1]));
      await provider.write(derivativeKey, new Uint8Array([2]));
      await provider.write(secondOriginalKey, new Uint8Array([4]));
      await provider.write(secondDerivativeKey, new Uint8Array([5]));
      await provider.write(siblingKey, new Uint8Array([6]));
      await provider.write(orphanKey, new Uint8Array([3]));

      await handOverFileRef(fileRefId, tenantB.tenantId);
      await handOverFileRef(secondFileRefId, tenantB.tenantId);

      await seedDestroyingTenant(tenantA.tenantId);
      const finalStatus = await driveDestructionToCompletion(
        tenantA.tenantId,
        async () => provider,
      );
      expect(finalStatus).toBe("destroyed");

      // A's own app-data stage never even sees these rows — by the time it ran,
      // the handover had already moved them to B.
      const rowsB = await selectMany(db, fileRefsTable, { tenantId: tenantB.tenantId });
      expect(rowsB).toHaveLength(2);

      // The silent-data-loss case the whole handover design exists to
      // prevent: A's storage-prefix sweep must not delete bytes a foreign
      // tenant's surviving row still references — originals AND derivatives.
      expect(await provider.exists(originalKey)).toBe(true);
      expect(await provider.exists(derivativeKey)).toBe(true);
      expect(await provider.exists(secondOriginalKey)).toBe(true);
      expect(await provider.exists(secondDerivativeKey)).toBe(true);
      // Orphans and stem-sharing siblings (no fileRef row anywhere) are still
      // swept — the exception above is narrow, not a general retreat.
      expect(await provider.exists(siblingKey)).toBe(false);
      expect(await provider.exists(orphanKey)).toBe(false);
    });
  });
});

describe("files-tenant-data :: destroy hooks respect deadlineAt", () => {
  const farFutureDeadline = Date.now() + 24 * 60 * 60 * 1000;

  test("fileRefTenantDestroyHook still purges one chunk at an expired deadline, reports done:false, and finishes on the next tick", async () => {
    await seedTenant(tenantA);
    const key = buildStorageKey(tenantA.tenantId, "fileRef", 1, "attachment", "photo.jpg", "u1");
    await seedFileRef(tenantA.tenantId, key);
    await seedFileRef(tenantA.tenantId, `${tenantA.tenantId}/second.bin`);

    const hookCtx = (deadlineAt: number) => ({
      db: createTenantDataDestroyDb({ db, tenantId: tenantA.tenantId }),
      registry: stack.registry,
      tenantId: tenantA.tenantId,
      deadlineAt,
      fileProviderResolver: async () => provider,
    });

    const expired = await fileRefTenantDestroyHook(hookCtx(0));
    expect(expired).toEqual({ done: false, processed: 2 });
    expect(await selectMany(db, fileRefsTable, { tenantId: tenantA.tenantId })).toHaveLength(0);

    const finished = await fileRefTenantDestroyHook(hookCtx(farFutureDeadline));
    expect(finished).toEqual({ done: true, processed: 0 });
    expect(await selectMany(db, fileRefsTable, { tenantId: tenantA.tenantId })).toHaveLength(0);
  });

  test("fileRefStorageDestroyHook still deletes one chunk at an expired deadline, reports done:false, and finishes on the next tick", async () => {
    await seedTenant(tenantA);
    const keys = [`${tenantA.tenantId}/a.bin`, `${tenantA.tenantId}/b.bin`];
    for (const key of keys) await provider.write(key, new Uint8Array([1]));

    const hookCtx = (deadlineAt: number) => ({
      tenantId: tenantA.tenantId,
      db: stack.db,
      deadlineAt,
      fileProviderResolver: async () => provider,
    });

    const expired = await fileRefStorageDestroyHook(tenantA.tenantId, hookCtx(0));
    expect(expired).toEqual({ done: false, processed: 2 });
    expect(await provider.list(`${tenantA.tenantId}/`)).toHaveLength(0);

    const finished = await fileRefStorageDestroyHook(tenantA.tenantId, hookCtx(farFutureDeadline));
    expect(finished).toEqual({ done: true, processed: 0 });
    expect(await provider.list(`${tenantA.tenantId}/`)).toHaveLength(0);
  });

  test("fileRefStorageDestroyHook still deletes a chunk when list() itself uses up the whole deadline", async () => {
    await seedTenant(tenantA);
    const keys = [`${tenantA.tenantId}/a.bin`, `${tenantA.tenantId}/b.bin`];
    for (const key of keys) await provider.write(key, new Uint8Array([1]));

    // The hook only consults the deadline after list(), so an already expired deadline is
    // exactly the state a list() that used up the whole budget leaves behind.
    const result = await fileRefStorageDestroyHook(tenantA.tenantId, {
      tenantId: tenantA.tenantId,
      db: stack.db,
      deadlineAt: Date.now() - 1,
      fileProviderResolver: async () => provider,
    });

    expect(result).toEqual({ done: false, processed: 2 });
    expect(await provider.list(`${tenantA.tenantId}/`)).toHaveLength(0);
  });

  test("fileRefStorageDestroyHook fails closed when deleting the last pending key throws", async () => {
    await seedTenant(tenantA);
    await provider.write(`${tenantA.tenantId}/only.bin`, new Uint8Array([1]));
    const failingProvider = {
      ...provider,
      delete: async () => {
        throw new Error("storage delete failed");
      },
    };

    await expect(
      fileRefStorageDestroyHook(tenantA.tenantId, {
        tenantId: tenantA.tenantId,
        db: stack.db,
        deadlineAt: farFutureDeadline,
        fileProviderResolver: async () => failingProvider,
      }),
    ).rejects.toThrow("storage delete failed");
    expect(await provider.list(`${tenantA.tenantId}/`)).toHaveLength(1);
  });
});
