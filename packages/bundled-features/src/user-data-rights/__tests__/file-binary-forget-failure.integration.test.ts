// Forget-Hook fail-closed Integration-Test.
//
// Beweist den Vertrag von runForgetCleanup für den fileRef-delete-Hook: wenn
// `storageProvider.delete()` fehlschlägt, wirft der Hook → die per-User-Sub-Tx
// rollt zurück → der User bleibt `DeletionRequested`, die Row + Binary bleiben,
// der Fehler landet im `errors`-Array. Der nächste Run (Storage wieder ok)
// konvergiert sauber, weil `delete` idempotent ist. Ohne den Throw würde ein
// transienter Storage-Fehler die Row permanent hard-löschen, den User auf
// `Deleted` flippen und die Binary dauerhaft verwaisen lassen (Art.-17-Erasure
// still unvollständig).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
  fileRefsTable,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createConfigAccessorFactory } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { fileFoundationFeature } from "../../file-foundation";
import { createFilesFeature } from "../../files";
import { createSessionsFeature, userSessionEntity } from "../../sessions";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults";
import { createUserDataRightsFeature } from "../feature";
import { makeTenantStorageProviderResolver } from "../lib/storage-provider-resolver";
import { runForgetCleanup } from "../run-forget-cleanup";
import {
  createForgetSeeders,
  createTestFileProviderFeature,
  type ForgetSeeders,
  nowInstant,
  READ_TENANT_MEMBERSHIPS_DDL,
} from "./forget-test-helpers";

const FILE_PROVIDER_CONFIG_KEY = "file-foundation:config:provider";

let stack: TestStack;
let db: DbConnection;
let base: InMemoryFileProvider;
let seed: ForgetSeeders;
// Per-tenant resolver for the direct runForgetCleanup calls — resolves through
// file-foundation to the flaky provider, same path the dispatcher handler uses.
let buildStorageProvider: (tenantId: string) => Promise<FileStorageProvider>;
// `delete` throws while set; flip off to simulate storage recovery on retry.
let failDeletes = true;

const TENANT = "00000000-0000-4000-8000-00000000000e";

beforeAll(async () => {
  base = createInMemoryFileProvider();
  // Spread the real provider (all methods bound to its store) and override
  // only `delete` to fail on demand — lets one test prove abort + retry-convergence.
  const flakyProvider: InMemoryFileProvider = {
    ...base,
    async delete(key) {
      if (failDeletes) throw new Error("storage unavailable (test)");
      return base.delete(key);
    },
  };
  // Forget resolves the binary store through file-foundation (production path).
  // The test plugin returns the flaky provider; selected app-wide via override.
  const appOverrides = new Map<string, string>([[FILE_PROVIDER_CONFIG_KEY, "test"]]);
  const resolver = createConfigResolver({ appOverrides });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createFilesFeature(),
      fileFoundationFeature,
      createTestFileProviderFeature(flakyProvider, "test"),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  db = stack.db;
  // Seeders write binaries through the real store (`base`), not the flaky
  // wrapper — the wrapper's `delete` failure is what the test exercises.
  seed = createForgetSeeders(db, base);
  buildStorageProvider = makeTenantStorageProviderResolver({
    registry: stack.registry,
    configResolver: resolver,
    secrets: undefined,
    db,
    userId: SYSTEM_USER_ID,
    handlerName: "test-forget-failure",
  });

  await unsafeCreateEntityTable(db, userEntity);
  await unsafeCreateEntityTable(db, userSessionEntity);
  await unsafeCreateEntityTable(db, tenantRetentionOverrideEntity);
  await unsafePushTables(db, { fileRefsTable, configValuesTable });
  await asRawClient(db).unsafe(READ_TENANT_MEMBERSHIPS_DDL);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  failDeletes = true;
  base.clear();
  await resetTestTables(db, [userTable, "read_tenant_memberships", fileRefsTable]);
});

async function fileRowCount(tenantId: string, insertedById: string): Promise<number> {
  const rows = await asRawClient(db).unsafe(
    `SELECT 1 FROM file_refs WHERE tenant_id = $1 AND inserted_by_id = $2`,
    [tenantId, insertedById],
  );
  return (rows as ReadonlyArray<unknown>).length;
}

describe("forget fail-closed :: storage.delete failure aborts the row hard-delete", () => {
  test("storage delete fails → user stays DeletionRequested, row + binary remain, error surfaced", async () => {
    const userId = "cccccccc-cccc-4ccc-8ccc-000000000001";
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT);
    const key = await seed.seedFile("dddddddd-dddd-4ddd-8ddd-000000000001", TENANT, userId);

    const result = await runForgetCleanup({
      db,
      registry: stack.registry,
      now: nowInstant(),
      buildStorageProvider,
    });

    // NOT flipped to Deleted — the sub-tx rolled back.
    expect(result.processedUserIds).not.toContain(userId);
    // Failure surfaced for operator visibility.
    expect(result.errors.some((e) => e.userId === userId && e.entityName === "fileRef")).toBe(true);
    // Row NOT hard-deleted; binary NOT orphaned.
    expect(await fileRowCount(TENANT, userId)).toBe(1);
    expect(await base.exists(key)).toBe(true);
    // User still pending deletion in the DB.
    const row = await fetchOne<{ status: string }>(db, userTable, { id: userId });
    expect(row?.status).toBe(USER_STATUS.DeletionRequested);
  });

  test("next run with storage healthy converges (idempotent delete) — user deleted, binary gone", async () => {
    const userId = "cccccccc-cccc-4ccc-8ccc-000000000002";
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT);
    const key = await seed.seedFile("dddddddd-dddd-4ddd-8ddd-000000000002", TENANT, userId);

    // First run: storage down → abort.
    const first = await runForgetCleanup({
      db,
      registry: stack.registry,
      now: nowInstant(),
      buildStorageProvider,
    });
    expect(first.processedUserIds).not.toContain(userId);
    expect(await base.exists(key)).toBe(true);

    // Storage recovers; retry converges.
    failDeletes = false;
    const second = await runForgetCleanup({
      db,
      registry: stack.registry,
      now: nowInstant(),
      buildStorageProvider,
    });

    expect(second.processedUserIds).toContain(userId);
    expect(await base.exists(key)).toBe(false);
    expect(await fileRowCount(TENANT, userId)).toBe(0);
    const row = await fetchOne<{ status: string }>(db, userTable, { id: userId });
    expect(row?.status).toBe(USER_STATUS.Deleted);
  });
});

// Same contract, but driven through the REAL dispatcher (POST run-forget-cleanup)
// rather than calling runForgetCleanup with a top-level connection. The
// dispatcher wraps the handler in an outer transaction, so ctx.db.raw is a
// TransactionSql — which has `.savepoint`, not `.begin`. The per-user sub-tx
// must open as a SAVEPOINT here; the previous `.begin`-only path threw on every
// user when invoked this way (the cron path), so production deleted nobody while
// these direct-connection tests stayed green. #214.
describe("forget-cleanup through the real dispatcher :: per-user savepoint nests under the handler tx", () => {
  const systemUser = {
    id: "00000000-0000-4000-8000-0000000000ff",
    tenantId: TENANT,
    roles: ["SystemAdmin"],
  };
  type CleanupResult = {
    readonly processedUserIds: readonly string[];
    readonly hookCallsAttempted: number;
    readonly errorCount: number;
    readonly errors: ReadonlyArray<{ readonly userId: string; readonly entityName: string }>;
  };
  const RUN_FORGET = "user-data-rights:write:run-forget-cleanup";

  test("dispatcher POST flips a due user to Deleted (SAVEPOINT inside the outer handler tx)", async () => {
    failDeletes = false;
    const userId = "cccccccc-cccc-4ccc-8ccc-000000000003";
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT);
    const key = await seed.seedFile("dddddddd-dddd-4ddd-8ddd-000000000003", TENANT, userId);

    const result = await stack.http.writeOk<CleanupResult>(RUN_FORGET, {}, systemUser);

    // Pre-fix this list was always empty — `.begin` is absent on the
    // dispatcher's TransactionSql, so the per-user sub-tx threw for every user.
    expect(result.processedUserIds).toContain(userId);
    expect(result.errorCount).toBe(0);
    expect(await base.exists(key)).toBe(false);
    expect(await fileRowCount(TENANT, userId)).toBe(0);
    const row = await fetchOne<{ status: string }>(db, userTable, { id: userId });
    expect(row?.status).toBe(USER_STATUS.Deleted);
  });

  test("fail-closed + retry-convergence through the dispatcher (savepoint rolls back one user)", async () => {
    const userId = "cccccccc-cccc-4ccc-8ccc-000000000004";
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT);
    const key = await seed.seedFile("dddddddd-dddd-4ddd-8ddd-000000000004", TENANT, userId);

    // Storage down → fileRef hook throws → ROLLBACK TO SAVEPOINT undoes just
    // this user; the outer handler tx still commits the run. User stays pending.
    failDeletes = true;
    const failed = await stack.http.writeOk<CleanupResult>(RUN_FORGET, {}, systemUser);
    expect(failed.processedUserIds).not.toContain(userId);
    expect(failed.errors.some((e) => e.userId === userId && e.entityName === "fileRef")).toBe(true);
    expect(await base.exists(key)).toBe(true);
    let row = await fetchOne<{ status: string }>(db, userTable, { id: userId });
    expect(row?.status).toBe(USER_STATUS.DeletionRequested);

    // Storage recovers → retry converges (idempotent delete).
    failDeletes = false;
    const ok = await stack.http.writeOk<CleanupResult>(RUN_FORGET, {}, systemUser);
    expect(ok.processedUserIds).toContain(userId);
    expect(await base.exists(key)).toBe(false);
    row = await fetchOne<{ status: string }>(db, userTable, { id: userId });
    expect(row?.status).toBe(USER_STATUS.Deleted);
  });
});
