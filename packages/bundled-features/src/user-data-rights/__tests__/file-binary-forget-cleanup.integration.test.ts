// Forget-Hook binary-Cleanup Integration-Test.
//
// Beweist, dass der `fileRef`-Forget-Hook bei strategy="delete" die
// Storage-Binaries via `storageProvider.delete()` entfernt, BEVOR die
// row hard-gelöscht wird — ohne provider leakt sonst jede gelöschte
// Datei ihre Bytes dauerhaft auf Disk (Issue gefunden im Review zu #177).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
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
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, userEntity, userTable } from "../../user";
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
let provider: InMemoryFileProvider;
let seed: ForgetSeeders;
// Per-tenant resolver the forget pipeline uses — built from the stack's
// configResolver, resolves "test" → the test provider plugin → `provider`.
let buildStorageProvider: (tenantId: string) => Promise<FileStorageProvider>;

const TENANT = "00000000-0000-4000-8000-00000000000c";

function uuid(suffix: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${suffix.toString(16).padStart(12, "0")}`;
}

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  // Forget resolves the binary store through file-foundation (the production
  // path) — mount it + a test plugin returning THIS provider, selected app-wide
  // via a config app-override (no admin write needed).
  const appOverrides = new Map<string, string>([[FILE_PROVIDER_CONFIG_KEY, "test"]]);
  const resolver = createConfigResolver({ appOverrides });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createFilesFeature(),
      fileFoundationFeature,
      createTestFileProviderFeature(provider, "test"),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
    files: { storageProvider: provider },
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  db = stack.db;
  seed = createForgetSeeders(db, provider);
  buildStorageProvider = makeTenantStorageProviderResolver({
    registry: stack.registry,
    configResolver: resolver,
    secrets: undefined,
    db,
    userId: SYSTEM_USER_ID,
    handlerName: "test-forget-cleanup",
  });

  await unsafeCreateEntityTable(db, userEntity);
  await unsafeCreateEntityTable(db, tenantRetentionOverrideEntity);
  await unsafePushTables(db, { fileRefsTable, configValuesTable });
  await asRawClient(db).unsafe(READ_TENANT_MEMBERSHIPS_DDL);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.clear();
  await resetTestTables(db, [userTable, "read_tenant_memberships", fileRefsTable]);
});

describe("forget-binary-cleanup :: storage.delete fires before row hard-delete", () => {
  test("Forget deletes the binary from the storage provider", async () => {
    const userId = uuid(1);
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT);
    const key = await seed.seedFile(uuid(101), TENANT, userId);
    expect(await provider.exists(key)).toBe(true);

    const result = await runForgetCleanup({
      db,
      registry: stack.registry,
      now: nowInstant(),
      buildStorageProvider,
    });

    expect(result.processedUserIds).toContain(userId);
    expect(await provider.exists(key)).toBe(false);
    expect(provider.keys()).not.toContain(key);
  });

  test("Multiple files from the same user — all binaries cleaned up", async () => {
    const userId = uuid(2);
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT);
    const keys = await Promise.all([
      seed.seedFile(uuid(201), TENANT, userId),
      seed.seedFile(uuid(202), TENANT, userId),
      seed.seedFile(uuid(203), TENANT, userId),
    ]);
    expect(provider.keys()).toHaveLength(3);

    await runForgetCleanup({
      db,
      registry: stack.registry,
      now: nowInstant(),
      buildStorageProvider,
    });

    for (const key of keys) {
      expect(await provider.exists(key)).toBe(false);
    }
    expect(provider.keys()).toHaveLength(0);
  });

  test("Other tenants' files stay untouched", async () => {
    const userId = uuid(3);
    const otherTenant = "00000000-0000-4000-8000-00000000000d";
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT);
    const myKey = await seed.seedFile(uuid(301), TENANT, userId);
    const otherKey = await seed.seedFile(uuid(302), otherTenant, "another-user");
    // The other-tenant file is owned by a different user; the forget run for
    // userId must NOT touch it.

    await runForgetCleanup({
      db,
      registry: stack.registry,
      now: nowInstant(),
      buildStorageProvider,
    });

    expect(await provider.exists(myKey)).toBe(false);
    expect(await provider.exists(otherKey)).toBe(true);
  });
});
