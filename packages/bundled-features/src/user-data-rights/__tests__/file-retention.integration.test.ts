// File-Retention Integration-Test.
//
// Beweist, dass die BESTEHENDE data-retention + Forget-Pipeline auch für
// `fileRef` greift — kein file-spezifischer Retention-Mechanismus. fileRef ist
// ein normales softDelete-ES-Entity; sein Forget-/Retention-Verhalten kommt
// aus genau derselben Kette wie bei jedem anderen Entity:
//
//   runForgetCleanup → resolveRetentionPolicyForTenant(entityName="fileRef")
//   → policyToStrategy → fileRef userData delete-Hook (delete | anonymize)
//
// Abgedeckt:
//   1. Default (keine Override-Policy) → Forget HARD-löscht die Datei (Art. 17).
//   2. Tenant-Retention-Override fileRef→anonymize → Forget anonymisiert
//      (insertedById=null, Row bleibt) statt zu löschen.
//   3. Per-Tenant: derselbe User, anonymize in Tenant A, delete in Tenant B —
//      die Policy entscheidet pro Tenant.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { tenantRetentionOverrideTable } from "../../data-retention/schema/tenant-retention-override";
import { createFilesFeature } from "../../files";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults";
import { createUserDataRightsFeature } from "../feature";
import { runForgetCleanup } from "../run-forget-cleanup";

let stack: TestStack;
let db: DbConnection;

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";
const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";

function uuid(suffix: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${suffix.toString(16).padStart(12, "0")}`;
}

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const NOW = (): Instant => getTemporal().Now.instant();
function pastInstant(): Instant {
  return getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);
}

let overrideExecutor: ReturnType<typeof createEventStoreExecutor>;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
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

  overrideExecutor = createEventStoreExecutor(
    tenantRetentionOverrideTable,
    tenantRetentionOverrideEntity,
    { entityName: "tenant-retention-override" },
  );
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(db, [
    userTable,
    "read_tenant_memberships",
    fileRefsTable,
    tenantRetentionOverrideTable,
  ]);
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

async function seedFileRef(id: string, tenantId: string, insertedById: string): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
     VALUES ($1, $2, $3, $4, 'application/pdf', 1024, $5) ON CONFLICT (id) DO NOTHING`,
    [id, tenantId, `storage/${id}`, `${id}.pdf`, insertedById],
  );
}

// Setzt einen Tenant-Retention-Override über die GLEICHE API die der
// Forget-Resolver liest — kein Test-Sonderpfad.
async function seedFileRetentionOverride(
  tenantId: string,
  config: { keepFor: string; strategy: string; reference?: string },
): Promise<void> {
  const by = { ...TestUsers.systemAdmin, tenantId };
  const result = await overrideExecutor.create(
    { entityName: "fileRef", config: JSON.stringify(config), reason: "test", tenantId },
    by,
    createTenantDb(db, tenantId, "system"),
  );
  if (!result.isSuccess)
    throw new Error(`seedFileRetentionOverride failed: ${JSON.stringify(result)}`);
}

async function fetchFileRow(
  id: string,
): Promise<{ id: string; inserted_by_id: string | null; is_deleted: boolean } | null> {
  const result = await asRawClient(db).unsafe(
    `SELECT id, inserted_by_id, is_deleted FROM file_refs WHERE id = $1`,
    [id],
  );
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  const rows = ((result as any).rows ?? result) as Array<{
    id: string;
    inserted_by_id: string | null;
    is_deleted: boolean;
  }>;
  return rows[0] ?? null;
}

describe("file-retention :: Forget-Pipeline greift für fileRef", () => {
  test("Default (keine Override-Policy) → Datei wird hart gelöscht (Art. 17)", async () => {
    const userId = uuid(1);
    await seedForgetUser(userId);
    await seedMembership(userId, TENANT_B);
    await seedFileRef(uuid(101), TENANT_B, userId);

    const result = await runForgetCleanup({ db, registry: stack.registry, now: NOW() });

    expect(result.processedUserIds).toContain(userId);
    // Hard-Delete: Row weg.
    expect(await fetchFileRow(uuid(101))).toBeNull();
  });

  test("Retention-Override fileRef→anonymize → Datei wird anonymisiert, Row bleibt", async () => {
    const userId = uuid(2);
    await seedForgetUser(userId);
    await seedMembership(userId, TENANT_A);
    await seedFileRef(uuid(201), TENANT_A, userId);
    await seedFileRetentionOverride(TENANT_A, { keepFor: "30d", strategy: "anonymize" });

    const result = await runForgetCleanup({ db, registry: stack.registry, now: NOW() });

    expect(result.processedUserIds).toContain(userId);
    const row = await fetchFileRow(uuid(201));
    // Anonymize: Row existiert weiter, aber ohne Personenbezug (insertedById null).
    expect(row).not.toBeNull();
    expect(row?.inserted_by_id).toBeNull();
    expect(row?.is_deleted).toBe(false);
  });

  test("Per-Tenant: derselbe User → anonymize in A, hard-delete in B", async () => {
    const userId = uuid(3);
    await seedForgetUser(userId);
    await seedMembership(userId, TENANT_A);
    await seedMembership(userId, TENANT_B);
    await seedFileRef(uuid(301), TENANT_A, userId);
    await seedFileRef(uuid(302), TENANT_B, userId);
    await seedFileRetentionOverride(TENANT_A, { keepFor: "30d", strategy: "anonymize" });
    // TENANT_B: kein Override → Default-Delete.

    await runForgetCleanup({ db, registry: stack.registry, now: NOW() });

    const aRow = await fetchFileRow(uuid(301));
    expect(aRow).not.toBeNull();
    expect(aRow?.inserted_by_id).toBeNull();

    expect(await fetchFileRow(uuid(302))).toBeNull();
  });
});
