// File-retention integration test.
//
// Verifies that the existing data-retention and Forget pipeline also applies to
// `fileRef`; there is no file-specific retention mechanism. `fileRef` is a
// regular soft-delete event-sourced entity, so its Forget and retention behavior
// uses the same chain as every other entity:
//
//   runForgetCleanup → resolveRetentionPolicyForTenant(entityName="fileRef")
//   → policyToStrategy → fileRef userData delete hook (delete | anonymize)
//
// Covered:
//   1. No override policy → Forget hard-deletes the file (Art. 17).
//   2. Tenant retention override fileRef→anonymize → Forget anonymizes the file
//      (insertedById=null; the row remains) instead of deleting it.
//   3. Per tenant: the same user is anonymized in Tenant A and deleted in Tenant B;
//      the policy is evaluated per tenant.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";

import {
  asRawClient,
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.ts";
import { tenantRetentionOverrideTable } from "../../data-retention/schema/tenant-retention-override.ts";
import { createFilesFeature } from "../../files/index.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { runForgetCleanup } from "../run-forget-cleanup.ts";

let stack: TestStack;
let db: DbConnection;

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";

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
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, userEntity);
  await unsafeCreateEntityTable(db, userSessionEntity);
  await unsafeCreateEntityTable(db, tenantRetentionOverrideEntity);
  await unsafePushTables(db, { fileRefsTable });
  await unsafeCreateEntityTable(db, tenantMembershipEntity);

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
    eventsTable,
  ]);
});

async function seedForgetUser(id: string): Promise<void> {
  await seedRowViaEventStore(db, userTable, {
    id,
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
  await seedRowViaEventStore(db, tenantMembershipsTable, {
    tenantId: tenantId,
    userId: userId,
    roles: '["Member"]',
  });
}

async function seedFileRef(id: string, tenantId: string, insertedById: string): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
     VALUES ($1, $2, $3, $4, 'application/pdf', 1024, $5) ON CONFLICT (id) DO NOTHING`,
    [id, tenantId, `storage/${id}`, `${id}.pdf`, insertedById],
  );
}

// Creates a tenant retention override through the same API read by the
// Forget resolver, avoiding a test-specific path.
async function seedFileRetentionOverride(
  tenantId: string,
  config: { keepFor: string; strategy: string; reference?: string },
): Promise<void> {
  const by = { ...TestUsers.systemAdmin, tenantId };
  const result = await overrideExecutor.create(
    { entityName: "fileRef", config: JSON.stringify(config), reason: "test", tenantId },
    by,
    createTenantDb({
      db,
      tenantId,
      mode: "system",
      reason: "test inspects file rows across tenants after the retention sweep",
    }),
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

describe("file-retention :: Forget pipeline applies to fileRef", () => {
  test("Default (no override policy) → File is hard-deleted (Art. 17)", async () => {
    const userId = uuid(1);
    await seedForgetUser(userId);
    await seedMembership(userId, TENANT_B);
    await seedFileRef(uuid(101), TENANT_B, userId);

    const result = await runForgetCleanup({ db, registry: stack.registry, now: NOW() });

    expect(result.processedUserIds).toContain(userId);
    // Hard-Delete: Row weg.
    expect(await fetchFileRow(uuid(101))).toBeNull();
  });

  test("Retention override fileRef→anonymize → File is anonymized, row remains", async () => {
    const userId = uuid(2);
    await seedForgetUser(userId);
    await seedMembership(userId, TENANT_A);
    await seedFileRef(uuid(201), TENANT_A, userId);
    await seedFileRetentionOverride(TENANT_A, { keepFor: "30d", strategy: "anonymize" });

    const result = await runForgetCleanup({ db, registry: stack.registry, now: NOW() });

    expect(result.processedUserIds).toContain(userId);
    const row = await fetchFileRow(uuid(201));
    // Anonymization keeps the row but removes its person reference
    // (insertedById is null).
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
    // No override for TENANT_B, so the default is deletion.

    await runForgetCleanup({ db, registry: stack.registry, now: NOW() });

    const aRow = await fetchFileRow(uuid(301));
    expect(aRow).not.toBeNull();
    expect(aRow?.inserted_by_id).toBeNull();

    expect(await fetchFileRow(uuid(302))).toBeNull();
  });
});
