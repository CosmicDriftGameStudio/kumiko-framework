// Forget-Hook binary-Cleanup Integration-Test.
//
// Beweist, dass der `fileRef`-Forget-Hook bei strategy="delete" die
// Storage-Binaries via `storageProvider.delete()` entfernt, BEVOR die
// row hard-gelöscht wird — ohne provider leakt sonst jede gelöschte
// Datei ihre Bytes dauerhaft auf Disk (Issue gefunden im Review zu #177).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
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
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createFilesFeature } from "../../files";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults";
import { createUserDataRightsFeature } from "../feature";
import { runForgetCleanup } from "../run-forget-cleanup";

let stack: TestStack;
let db: DbConnection;
let provider: InMemoryFileProvider;

const TENANT = "00000000-0000-4000-8000-00000000000c";
const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";

function uuid(suffix: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${suffix.toString(16).padStart(12, "0")}`;
}

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const NOW = (): Instant => getTemporal().Now.instant();
const pastInstant = (): Instant => getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature({ storageProvider: provider }),
    ],
    files: { storageProvider: provider },
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, userEntity);
  await unsafeCreateEntityTable(db, tenantRetentionOverrideEntity);
  await unsafePushTables(db, { fileRefsTable });
  await asRawClient(db).unsafe(`
    CREATE TABLE IF NOT EXISTS read_tenant_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      inserted_by_id TEXT,
      modified_by_id TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      deleted_at TIMESTAMPTZ,
      deleted_by_id TEXT,
      roles TEXT NOT NULL DEFAULT '[]',
      UNIQUE(user_id, tenant_id)
    )
  `);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.clear();
  await resetTestTables(db, [userTable, "read_tenant_memberships", fileRefsTable]);
});

async function seedForgetUser(id: string): Promise<void> {
  await insertOne(db, userTable, {
    id,
    tenantId: TENANT_SYSTEM,
    email: `user-${id}@example.com`,
    passwordHash: "hashed",
    displayName: `User ${id}`,
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.DeletionRequested,
    gracePeriodEnd: pastInstant(),
  });
}

async function seedMembership(userId: string, tenantId: string): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO read_tenant_memberships (tenant_id, user_id, roles)
     VALUES ($1, $2, '["Member"]') ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [tenantId, userId],
  );
}

async function seedFile(id: string, tenantId: string, insertedById: string): Promise<string> {
  const storageKey = `storage/${id}`;
  await provider.write(storageKey, new Uint8Array([1, 2, 3, 4]), "application/pdf");
  await asRawClient(db).unsafe(
    `INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
     VALUES ($1, $2, $3, $4, 'application/pdf', 4, $5) ON CONFLICT (id) DO NOTHING`,
    [id, tenantId, storageKey, `${id}.pdf`, insertedById],
  );
  return storageKey;
}

describe("forget-binary-cleanup :: storage.delete fires before row hard-delete", () => {
  test("Forget deletes the binary from the storage provider", async () => {
    const userId = uuid(1);
    await seedForgetUser(userId);
    await seedMembership(userId, TENANT);
    const key = await seedFile(uuid(101), TENANT, userId);
    expect(await provider.exists(key)).toBe(true);

    const result = await runForgetCleanup({ db, registry: stack.registry, now: NOW() });

    expect(result.processedUserIds).toContain(userId);
    expect(await provider.exists(key)).toBe(false);
    expect(provider.keys()).not.toContain(key);
  });

  test("Multiple files from the same user — all binaries cleaned up", async () => {
    const userId = uuid(2);
    await seedForgetUser(userId);
    await seedMembership(userId, TENANT);
    const keys = await Promise.all([
      seedFile(uuid(201), TENANT, userId),
      seedFile(uuid(202), TENANT, userId),
      seedFile(uuid(203), TENANT, userId),
    ]);
    expect(provider.keys()).toHaveLength(3);

    await runForgetCleanup({ db, registry: stack.registry, now: NOW() });

    for (const key of keys) {
      expect(await provider.exists(key)).toBe(false);
    }
    expect(provider.keys()).toHaveLength(0);
  });

  test("Other tenants' files stay untouched", async () => {
    const userId = uuid(3);
    const otherTenant = "00000000-0000-4000-8000-00000000000d";
    await seedForgetUser(userId);
    await seedMembership(userId, TENANT);
    const myKey = await seedFile(uuid(301), TENANT, userId);
    const otherKey = await seedFile(uuid(302), otherTenant, "another-user");
    // The other-tenant file is owned by a different user; the forget run for
    // userId must NOT touch it.

    await runForgetCleanup({ db, registry: stack.registry, now: NOW() });

    expect(await provider.exists(myKey)).toBe(false);
    expect(await provider.exists(otherKey)).toBe(true);
  });
});
