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
import {
  createInMemoryFileProvider,
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
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createFilesFeature } from "../../files";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults";
import { createUserDataRightsFeature } from "../feature";
import { runForgetCleanup } from "../run-forget-cleanup";
import {
  createForgetSeeders,
  type ForgetSeeders,
  nowInstant,
  READ_TENANT_MEMBERSHIPS_DDL,
} from "./forget-test-helpers";

let stack: TestStack;
let db: DbConnection;
let base: InMemoryFileProvider;
let seed: ForgetSeeders;
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
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature({ storageProvider: flakyProvider }),
    ],
    files: { storageProvider: flakyProvider },
  });
  db = stack.db;
  // Seeders write binaries through the real store (`base`), not the flaky
  // wrapper — the wrapper's `delete` failure is what the test exercises.
  seed = createForgetSeeders(db, base);

  await unsafeCreateEntityTable(db, userEntity);
  await unsafeCreateEntityTable(db, tenantRetentionOverrideEntity);
  await unsafePushTables(db, { fileRefsTable });
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

    const result = await runForgetCleanup({ db, registry: stack.registry, now: nowInstant() });

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
    const first = await runForgetCleanup({ db, registry: stack.registry, now: nowInstant() });
    expect(first.processedUserIds).not.toContain(userId);
    expect(await base.exists(key)).toBe(true);

    // Storage recovers; retry converges.
    failDeletes = false;
    const second = await runForgetCleanup({ db, registry: stack.registry, now: nowInstant() });

    expect(second.processedUserIds).toContain(userId);
    expect(await base.exists(key)).toBe(false);
    expect(await fileRowCount(TENANT, userId)).toBe(0);
    const row = await fetchOne<{ status: string }>(db, userTable, { id: userId });
    expect(row?.status).toBe(USER_STATUS.Deleted);
  });
});
