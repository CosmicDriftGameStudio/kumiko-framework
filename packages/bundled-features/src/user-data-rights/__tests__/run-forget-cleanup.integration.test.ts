// Forget-cleanup runner integration test.
//
// User requirement: after the deletion period, no data should remain, including
// across tenants. This test runs the pipeline and verifies:
//   - Expired grace period + DeletionRequested → user row anonymized,
//     status=Deleted, and all of the user's file_refs removed in ALL tenants.
//   - Cross-tenant: Alice belongs to Tenant A + B, so Forget iterates both
//     memberships.
//   - Future grace period: a user with gracePeriodEnd > now remains untouched.
//   - Other-user isolation: Bob (active) loses no data.
//   - Idempotency: the second run is a no-op.
//
// Strategy mapping (retention.strategy → UserDataDeleteStrategy) is pinned in
// the unit test (policy-to-strategy.test.ts), not here. This covers only the
// end-to-end default path (delete).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";

import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient, createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  seedRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
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
import { createFilesFeature } from "../../files/index.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import {
  createUserFeature,
  USER_ANONYMIZED_DISPLAY_NAME,
  USER_DELETED_DISPLAY_NAME,
  USER_STATUS,
  UserHandlers,
  userEntity,
  userTable,
} from "../../user/index.ts";
import { seedUser as seedUserViaExecutor } from "../../user/seeding.ts";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { updateUserLifecycle } from "../lib/update-user-lifecycle.ts";
import { runForgetCleanup } from "../run-forget-cleanup.ts";
import { UserDataRightsHandlers, UserDataRightsJobs } from "../web/constants.ts";
import {
  decryptEmail,
  emailsIn,
  expectEmailsShredded,
  setupSubjectKmsForTest,
} from "./forget-shredding-test-helpers.ts";

let stack: TestStack;

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";

// Deterministic UUIDs for tests — uses the same helper as
// user-data-rights-defaults.
function uuid(suffix: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${suffix.toString(16).padStart(12, "0")}`;
}

const ALICE_ID = uuid(1);
const BOB_ID = uuid(2);
const FUTURE_USER_ID = uuid(3);

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

  await unsafeCreateEntityTable(stack.db, userEntity);
  // The sessions feature is mounted, so the defaults' user-session hook runs
  // during Forget and requires this table.
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  // The tenant feature is not in this stack, so create the membership table
  // directly from its entity.
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
  // fileRef is driven by buildEntityTable (softDelete), so push the real entity
  // table instead of using hand-written SQL to include is_deleted/deleted_at/deleted_by_id.
  await unsafePushTables(stack.db, { fileRefsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    "read_tenant_memberships",
    fileRefsTable,
    eventsTable,
  ]);
});

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

function instantFromOffsetMs(offsetMs: number): Instant {
  return getTemporal().Instant.fromEpochMilliseconds(Date.now() + offsetMs);
}

const NOW = (): Instant => getTemporal().Now.instant();

async function seedUser(
  id: string,
  overrides: {
    status?: string;
    gracePeriodEnd?: Instant | null;
    email?: string;
    displayName?: string;
  } = {},
): Promise<void> {
  await seedRowViaEventStore(stack.db, userTable, {
    id,
    email: overrides.email ?? `user-${id}@example.com`,
    passwordHash: "hashed",
    displayName: overrides.displayName ?? `User ${id}`,
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: overrides.status ?? USER_STATUS.Active,
    gracePeriodEnd: overrides.gracePeriodEnd ?? null,
  });
}

async function seedMembership(userId: string, tenantId: string): Promise<void> {
  await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
    tenantId: tenantId,
    userId: userId,
    roles: '["Member"]',
  });
}

async function seedFileRef(
  id: string,
  tenantId: string,
  insertedById: string | null,
  fileName: string,
): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `
    INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
    VALUES ($1, $2, $3, $4, 'application/pdf', 1024, $5)
    ON CONFLICT (id) DO NOTHING
  `,
    [id, tenantId, `storage/${id}`, fileName, insertedById],
  );
}

async function fetchUser(id: string): Promise<{
  email: string;
  display_name: string;
  password_hash: string | null;
  status: string;
  deleted_at: string | null;
} | null> {
  const result = await asRawClient(stack.db).unsafe(
    `
    SELECT email, display_name, password_hash, status, deleted_at
    FROM read_users WHERE id = $1
  `,
    [id],
  );
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  const rows = ((result as any).rows ?? result) as Array<{
    email: string;
    display_name: string;
    password_hash: string | null;
    status: string;
    deleted_at: string | null;
  }>;
  return rows[0] ?? null;
}

async function fetchFileRefsForUser(tenantId: string, userId: string): Promise<unknown[]> {
  const result = await asRawClient(stack.db).unsafe(
    `
    SELECT id, file_name, inserted_by_id
    FROM file_refs WHERE tenant_id = $1 AND inserted_by_id = $2
  `,
    [tenantId, userId],
  );
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  return ((result as any).rows ?? result) as unknown[];
}

async function fetchAllFileRefs(tenantId: string): Promise<unknown[]> {
  const result = await asRawClient(stack.db).unsafe(
    `
    SELECT id, file_name, inserted_by_id FROM file_refs WHERE tenant_id = $1
  `,
    [tenantId],
  );
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  return ((result as any).rows ?? result) as unknown[];
}

describe("runForgetCleanup :: happy path (Cross-Tenant Account-Deletion)", () => {
  test("Alice (DeletionRequested + grace expired) → user anonymized + files weg in beiden Tenants", async () => {
    // Alice has files in both tenants.
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000), // 1min ago
      email: "alice@example.com",
      displayName: "Alice",
    });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedMembership(ALICE_ID, TENANT_B);
    await seedFileRef(uuid(101), TENANT_A, ALICE_ID, "alice-a-doc.pdf");
    await seedFileRef(uuid(102), TENANT_A, ALICE_ID, "alice-a-other.pdf");
    await seedFileRef(uuid(103), TENANT_B, ALICE_ID, "alice-b-doc.pdf");

    // Bob (active) is a negative control with his own files — they must remain
    // untouched.
    await seedUser(BOB_ID);
    await seedMembership(BOB_ID, TENANT_A);
    await seedFileRef(uuid(201), TENANT_A, BOB_ID, "bob-a-doc.pdf");

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });

    expect(result.processedUserIds).toContain(ALICE_ID);
    expect(result.errors).toEqual([]);

    // User-Row anonymisiert + status=Deleted (default-strategy=delete).
    const aliceRow = await fetchUser(ALICE_ID);
    expect(aliceRow).not.toBeNull();
    expect(aliceRow?.status).toBe(USER_STATUS.Deleted);
    // userDeleteHook replaces email/displayName with pseudonyms (see
    // user-data-rights-defaults/hooks/user.userdata-hook). Verify that the
    // ORIGINAL PII is gone — this is the essential GDPR assertion.
    expect(aliceRow?.email).not.toContain("alice@example.com");
    expect(aliceRow?.email).toContain("anonymized.invalid");
    expect([USER_DELETED_DISPLAY_NAME, USER_ANONYMIZED_DISPLAY_NAME]).toContain(
      aliceRow!.display_name,
    );
    expect(aliceRow?.password_hash).toBeNull();

    // Alice's files in Tenant A + B beide weg (Cross-Tenant beweis).
    expect(await fetchFileRefsForUser(TENANT_A, ALICE_ID)).toHaveLength(0);
    expect(await fetchFileRefsForUser(TENANT_B, ALICE_ID)).toHaveLength(0);

    // Bob's file in Tenant A bleibt.
    const bobFiles = await fetchFileRefsForUser(TENANT_A, BOB_ID);
    expect(bobFiles).toHaveLength(1);
    const bobUser = await fetchUser(BOB_ID);
    expect(bobUser?.status).toBe(USER_STATUS.Active);
    expect(bobUser?.email).toBe(`user-${BOB_ID}@example.com`);
  });
});

describe("run-forget-cleanup :: registered cron (autonomous Art.17)", () => {
  // Verifies that Forget cleanup is registered as an autonomous cron rather
  // than only as a manual runForget API. Without the r.job registration,
  // getJob returns undefined and deletion never runs after the grace period.
  // Drive the actual registered job through the real JobContext (db + registry,
  // no config), rather than the inner runForgetCleanup helper.
  function capturingJobLog() {
    const warns: string[] = [];
    const log: JobContext["obs"]["log"] = {
      info() {},
      warn(message: string) {
        warns.push(message);
      },
      error() {},
      debug() {},
      child(): JobContext["obs"]["log"] {
        return this;
      },
    };
    return { log, warns };
  }

  test("registered job exists + erases through the real JobContext", async () => {
    const job = stack.registry.getJob(UserDataRightsJobs.runForgetCleanup);
    expect(job).toBeTruthy();

    const CRON_USER = uuid(7);
    await seedUser(CRON_USER, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: "cron-delete@example.com",
      displayName: "CronDelete",
    });
    await seedMembership(CRON_USER, TENANT_A);

    const { log } = capturingJobLog();
    const jobCtx = {
      db: createTenantDb({
        db: stack.db,
        tenantId: TENANT_A,
        mode: "tenant",
        grants: {
          unsafeRaw: { reason: "executes overdue Art.17 forget requests across every tenant" },
        },
      }),
      registry: stack.registry,
      obs: { log },
      systemUser: createSystemUser(TENANT_A),
    };
    await job?.handler({}, jobCtx as unknown as JobContext);

    const row = await fetchUser(CRON_USER);
    expect(row?.status).toBe(USER_STATUS.Deleted);
    expect(row?.email).not.toContain("cron-delete@example.com");
    expect(row?.email).toContain("anonymized.invalid");
  });

  test("incomplete hooks are written to ctx.obs.log (job-run audit trail, #1572)", async () => {
    const job = stack.registry.getJob(UserDataRightsJobs.runForgetCleanup);
    expect(job).toBeTruthy();

    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);

    const usages = stack.registry.getExtensionUsages("userData");
    const userUsage = usages.find((u) => u.entityName === "user");
    if (!userUsage?.options) throw new Error("user usage not found");
    type DeleteHook = (
      ctx: { userId: string; tenantId: string; db: unknown },
      strategy: string,
    ) => Promise<undefined | { status: "ok" } | { status: "incomplete"; reason: string }>;
    const originalUserDelete = (userUsage.options as { delete: DeleteHook }).delete;
    (userUsage.options as { delete: DeleteHook }).delete = async (ctx, strategy) => {
      if (ctx.userId === ALICE_ID) {
        return { status: "incomplete", reason: "synthetic partial cleanup for alice" };
      }
      return originalUserDelete(ctx, strategy);
    };

    const { log, warns } = capturingJobLog();
    try {
      await job?.handler({}, {
        db: createTenantDb({
          db: stack.db,
          tenantId: TENANT_A,
          mode: "tenant",
          grants: {
            unsafeRaw: { reason: "executes overdue Art.17 forget requests across every tenant" },
          },
        }),
        registry: stack.registry,
        systemUser: createSystemUser(TENANT_A),
        obs: { log },
      } as unknown as JobContext);
    } finally {
      (userUsage.options as { delete: DeleteHook }).delete = originalUserDelete;
    }

    const hit = warns.find((w) => w.includes("incomplete hook") && w.includes(ALICE_ID));
    expect(hit).toBeDefined();
    expect(hit).toContain("entityName=user");
    expect(hit).toContain("rolledBack=false");
    expect(hit).toContain("reason=synthetic partial cleanup for alice");

    const aliceRow = await fetchUser(ALICE_ID);
    expect(aliceRow?.status).toBe(USER_STATUS.Deleted);
  });
});

describe("runForgetCleanup :: time-window guards", () => {
  test("Future-grace User wird NICHT bearbeitet", async () => {
    await seedUser(FUTURE_USER_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(7 * 24 * 60 * 60 * 1000), // +7d
    });
    await seedMembership(FUTURE_USER_ID, TENANT_A);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });

    expect(result.processedUserIds).toEqual([]);
    expect(result.hookCallsAttempted).toBe(0);

    const userRow = await fetchUser(FUTURE_USER_ID);
    expect(userRow?.status).toBe(USER_STATUS.DeletionRequested);
    expect(userRow?.email).toBe(`user-${FUTURE_USER_ID}@example.com`);
  });

  test("Active-User (kein Forget-Antrag) wird NICHT bearbeitet", async () => {
    await seedUser(ALICE_ID, { status: USER_STATUS.Active });
    await seedMembership(ALICE_ID, TENANT_A);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });

    expect(result.processedUserIds).toEqual([]);
    const aliceRow = await fetchUser(ALICE_ID);
    expect(aliceRow?.status).toBe(USER_STATUS.Active);
    expect(aliceRow?.email).toBe(`user-${ALICE_ID}@example.com`);
  });
});

describe("runForgetCleanup :: idempotenz", () => {
  test("zweiter Run nach Cleanup ist no-op", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedFileRef(uuid(301), TENANT_A, ALICE_ID, "alice-doc.pdf");

    const firstRun = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });
    expect(firstRun.processedUserIds).toContain(ALICE_ID);

    const secondRun = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });
    // No users remain in DeletionRequested after Run 1, so Run 2 finds nothing.
    expect(secondRun.processedUserIds).toEqual([]);
    expect(secondRun.hookCallsAttempted).toBe(0);
  });
});

describe("runForgetCleanup :: PII-Audit nach Cleanup", () => {
  test("nach Cleanup ist KEINE Original-PII (email + displayName) mehr in DB", async () => {
    // Cross-data PII check: simulate multiple data points linked to Alice's
    // identity, then verify that none still contain her original values.
    const ORIGINAL_EMAIL = "alice.unique.audit@example.com";
    const ORIGINAL_NAME = "Alice Audit Mueller";
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: ORIGINAL_EMAIL,
      displayName: ORIGINAL_NAME,
    });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedFileRef(uuid(401), TENANT_A, ALICE_ID, "alice-medical-record.pdf");

    await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });

    // Cross-table PII check: can any original values still be found anywhere?
    const userRows = await asRawClient(stack.db).unsafe(
      `
      SELECT id FROM read_users WHERE email = $1 OR display_name = $2
    `,
      [ORIGINAL_EMAIL, ORIGINAL_NAME],
    );
    // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
    const userMatches = (userRows as any).rows ?? userRows;
    expect(userMatches).toHaveLength(0);

    const fileRows = await fetchAllFileRefs(TENANT_A);
    expect(fileRows).toHaveLength(0);
  });
});

describe("runForgetCleanup :: 0-Memberships orphan-Pfad", () => {
  // The orphan path previously flipped status=Deleted without running
  // userDeleteHook, leaving email/displayName/passwordHash unchanged. It looked
  // compliant but was not.
  test("User ohne Memberships → trotzdem PII anonymisiert (kein leerer status-Flip)", async () => {
    const ORIGINAL_EMAIL = "orphan.unique@example.com";
    const ORIGINAL_NAME = "Orphan Original";
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: ORIGINAL_EMAIL,
      displayName: ORIGINAL_NAME,
    });
    // No seedMembership calls — this user is an orphan.

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });

    expect(result.processedUserIds).toContain(ALICE_ID);
    expect(result.errors).toEqual([]);

    const aliceRow = await fetchUser(ALICE_ID);
    expect(aliceRow?.status).toBe(USER_STATUS.Deleted);
    // Essential PII check: the original values are gone and pseudonyms are present.
    expect(aliceRow?.email).not.toBe(ORIGINAL_EMAIL);
    expect(aliceRow?.email).toContain("anonymized.invalid");
    expect(aliceRow?.display_name).not.toBe(ORIGINAL_NAME);
    expect(aliceRow?.password_hash).toBeNull();
  });
});

describe("runForgetCleanup :: sendDeletionExecutedEmail callback (Atom 5b)", () => {
  test("happy: callback fires mit userEmail PRE-tx + tenantIds + executedAt nach success", async () => {
    const ORIGINAL_EMAIL = "alice.callback@example.com";
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: ORIGINAL_EMAIL,
    });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedMembership(ALICE_ID, TENANT_B);

    type CallbackCall = {
      userId: string;
      userEmail: string;
      tenantIds: readonly string[];
      executedAt: string;
    };
    const calls: CallbackCall[] = [];
    const sendDeletionExecutedEmail = async (args: CallbackCall): Promise<void> => {
      calls.push(args);
    };

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
      sendDeletionExecutedEmail,
    });

    expect(result.processedUserIds).toContain(ALICE_ID);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.userId).toBe(ALICE_ID);
    // Pre-transaction cache: pass the original email, not the anonymized version
    // that the user hook sets during the transaction.
    expect(calls[0]?.userEmail).toBe(ORIGINAL_EMAIL);
    // Cross-Tenant-Beweis: callback bekommt beide Tenants.
    expect(calls[0]?.tenantIds).toHaveLength(2);
    expect(calls[0]?.tenantIds).toContain(TENANT_A);
    expect(calls[0]?.tenantIds).toContain(TENANT_B);
    expect(calls[0]?.executedAt).toBeTruthy();

    // Anonymization still completed because the callback runs after success.
    const aliceRow = await fetchUser(ALICE_ID);
    expect(aliceRow?.email).not.toBe(ORIGINAL_EMAIL);
    expect(aliceRow?.email).toContain("anonymized.invalid");
  });

  test("kein callback-Optional → success ohne crash, processedUserIds enthaelt User", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
      // KEIN sendDeletionExecutedEmail
    });

    expect(result.processedUserIds).toContain(ALICE_ID);
    expect(result.errors).toEqual([]);
  });

  test("failed Sub-Tx (synthetic Hook-Throw) → callback NICHT gefeuert", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);

    type CallbackCall = { userId: string };
    const calls: CallbackCall[] = [];

    const usages = stack.registry.getExtensionUsages("userData");
    const userUsage = usages.find((u) => u.entityName === "user");
    if (!userUsage?.options) throw new Error("user usage not found");
    const originalUserDelete = (
      userUsage.options as {
        delete: (
          ctx: { userId: string; tenantId: string; db: unknown },
          strategy: string,
        ) => Promise<void>;
      }
    ).delete;
    (
      userUsage.options as {
        delete: (
          ctx: { userId: string; tenantId: string; db: unknown },
          strategy: string,
        ) => Promise<void>;
      }
    ).delete = async () => {
      throw new Error("synthetic hook failure");
    };

    try {
      const result = await runForgetCleanup({
        db: stack.db,
        registry: stack.registry,
        now: NOW(),
        sendDeletionExecutedEmail: async (args) => {
          calls.push({ userId: args.userId });
        },
      });

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.processedUserIds).not.toContain(ALICE_ID);
      // Key assertion: a failed sub-transaction must not send a notification;
      // otherwise users could receive deletion emails even though their data was
      // not actually deleted, creating a GDPR mismatch between the user's
      // expectation and the database state.
      expect(calls).toHaveLength(0);
    } finally {
      (
        userUsage.options as {
          delete: (
            ctx: { userId: string; tenantId: string; db: unknown },
            strategy: string,
          ) => Promise<void>;
        }
      ).delete = originalUserDelete;
    }
  });

  test("best-effort: callback-Throw fuer User A killt Batch NICHT — User B trotzdem verarbeitet", async () => {
    // If sendEmail throws for User A, batch cleanup must continue for User B.
    // User A's sub-transaction has already committed, so propagating the throw
    // would make the job fail; a retry would find no expired users because all
    // are already Deleted, causing a silent miss.
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: "alice.throws@example.com",
    });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedUser(BOB_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: "bob.success@example.com",
    });
    await seedMembership(BOB_ID, TENANT_A);

    const calls: Array<{ userId: string }> = [];
    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
      sendDeletionExecutedEmail: async (args) => {
        calls.push({ userId: args.userId });
        if (args.userId === ALICE_ID) {
          throw new Error("synthetic email transport failure for alice");
        }
      },
    });

    // Both users were processed — Alice's callback error did not affect Bob,
    // confirming that try/catch stops the error from bubbling.
    expect(result.processedUserIds).toContain(ALICE_ID);
    expect(result.processedUserIds).toContain(BOB_ID);
    expect(result.errors).toEqual([]);

    // Beide Callbacks angerufen.
    expect(calls.map((c) => c.userId).sort()).toEqual([ALICE_ID, BOB_ID].sort());

    // Both database rows were deleted: the callback throws after the cleanup
    // sub-transaction has committed, so it cannot roll the cleanup back.
    expect((await fetchUser(ALICE_ID))?.status).toBe(USER_STATUS.Deleted);
    expect((await fetchUser(BOB_ID))?.status).toBe(USER_STATUS.Deleted);
  });

  test("User ohne email-Field (NULL) → callback NICHT gefeuert (skip ohne crash)", async () => {
    // Edge case: the email column may be empty if a previous user hook already
    // anonymized the user while leaving the status unchanged, or because of an
    // external migration. Skipping the callback prevents invalid arguments from
    // causing it to fail.
    await seedRowViaEventStore(stack.db, userTable, {
      id: ALICE_ID,
      email: "",
      passwordHash: "hashed",
      displayName: "Alice",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);

    const calls: Array<{ userId: string }> = [];
    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
      sendDeletionExecutedEmail: async (args) => {
        calls.push({ userId: args.userId });
      },
    });

    expect(result.processedUserIds).toContain(ALICE_ID);
    expect(calls).toHaveLength(0);
  });
});

describe("runForgetCleanup :: per-User-Sub-Tx-Isolation (advisor-pinned Architektur)", () => {
  // Verifies the load-bearing property that a failing hook for User A cannot
  // roll User B back with it. Removing the sub-transaction from
  // run-forget-cleanup.ts must make this test fail.
  test("failing Hook bei User A → User B trotzdem cleaned, A bleibt im DeletionRequested", async () => {
    const ORIGINAL_A_EMAIL = "alice.failing.hook@example.com";
    const ORIGINAL_B_EMAIL = "bob.success.hook@example.com";

    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: ORIGINAL_A_EMAIL,
    });
    await seedMembership(ALICE_ID, TENANT_A);

    await seedUser(BOB_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: ORIGINAL_B_EMAIL,
    });
    await seedMembership(BOB_ID, TENANT_A);

    // Inject a failing hook that throws only for Alice through a custom
    // pseudo-extension usage in the registry. registry.getExtensionUsages
    // returns a list, so spy on the first existing hook.
    const usages = stack.registry.getExtensionUsages("userData");
    const userUsage = usages.find((u) => u.entityName === "user");
    if (!userUsage?.options) throw new Error("user usage not found");
    const originalUserDelete = (
      userUsage.options as {
        delete: (
          ctx: { userId: string; tenantId: string; db: unknown },
          strategy: string,
        ) => Promise<void>;
      }
    ).delete;
    (
      userUsage.options as {
        delete: (
          ctx: { userId: string; tenantId: string; db: unknown },
          strategy: string,
        ) => Promise<void>;
      }
    ).delete = async (ctx: { userId: string; tenantId: string; db: unknown }, strategy: string) => {
      if (ctx.userId === ALICE_ID) {
        throw new Error("synthetic hook failure for alice");
      }
      return originalUserDelete(ctx, strategy);
    };

    try {
      const result = await runForgetCleanup({
        db: stack.db,
        registry: stack.registry,
        now: NOW(),
      });

      // Bob was processed, but Alice was not.
      expect(result.processedUserIds).toContain(BOB_ID);
      expect(result.processedUserIds).not.toContain(ALICE_ID);
      expect(result.errors.some((e) => e.userId === ALICE_ID)).toBe(true);

      // Alice is unchanged because the sub-transaction rolled back: her original
      // PII remains and the status is still DeletionRequested for a retry.
      const aliceRow = await fetchUser(ALICE_ID);
      expect(aliceRow?.status).toBe(USER_STATUS.DeletionRequested);
      expect(aliceRow?.email).toBe(ORIGINAL_A_EMAIL);

      // Bob anonymisiert + Deleted.
      const bobRow = await fetchUser(BOB_ID);
      expect(bobRow?.status).toBe(USER_STATUS.Deleted);
      expect(bobRow?.email).not.toBe(ORIGINAL_B_EMAIL);
      expect(bobRow?.email).toContain("anonymized.invalid");

      // The error detail contains the correct tenant and entity name.
      const aliceError = result.errors.find((e) => e.userId === ALICE_ID);
      expect(aliceError?.tenantId).toBe(TENANT_A);
      expect(aliceError?.entityName).toBe("user");
    } finally {
      // Restore the hook spy so other tests in this file are unaffected. The
      // registry is shared across tests, even though beforeEach clears the DB.
      (
        userUsage.options as {
          delete: (
            ctx: { userId: string; tenantId: string; db: unknown },
            strategy: string,
          ) => Promise<void>;
        }
      ).delete = originalUserDelete;
    }
  });

  test("Hook meldet {status:'incomplete'} → kein Rollback, User trotzdem Deleted, im result.incomplete gesammelt", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);

    const usages = stack.registry.getExtensionUsages("userData");
    const userUsage = usages.find((u) => u.entityName === "user");
    if (!userUsage?.options) throw new Error("user usage not found");
    const originalUserDelete = (
      userUsage.options as {
        delete: (
          ctx: { userId: string; tenantId: string; db: unknown },
          strategy: string,
        ) => Promise<undefined | { status: "ok" } | { status: "incomplete"; reason: string }>;
      }
    ).delete;
    (
      userUsage.options as {
        delete: (
          ctx: { userId: string; tenantId: string; db: unknown },
          strategy: string,
        ) => Promise<undefined | { status: "ok" } | { status: "incomplete"; reason: string }>;
      }
    ).delete = async (ctx: { userId: string; tenantId: string; db: unknown }, strategy: string) => {
      if (ctx.userId === ALICE_ID) {
        return { status: "incomplete", reason: "synthetic partial cleanup for alice" };
      }
      return originalUserDelete(ctx, strategy);
    };

    try {
      const result = await runForgetCleanup({
        db: stack.db,
        registry: stack.registry,
        now: NOW(),
      });

      // No hard failure: user flipped, no errors entry.
      expect(result.processedUserIds).toContain(ALICE_ID);
      expect(result.errors.some((e) => e.userId === ALICE_ID)).toBe(false);

      // But collected in the incomplete set with reason + tenant + entity.
      const aliceIncomplete = result.incomplete.find((i) => i.userId === ALICE_ID);
      expect(aliceIncomplete?.reason).toBe("synthetic partial cleanup for alice");
      expect(aliceIncomplete?.tenantId).toBe(TENANT_A);
      expect(aliceIncomplete?.entityName).toBe("user");
      expect(aliceIncomplete?.rolledBack).toBe(false);

      // Status flip proceeded despite the incomplete report.
      const aliceRow = await fetchUser(ALICE_ID);
      expect(aliceRow?.status).toBe(USER_STATUS.Deleted);
    } finally {
      (
        userUsage.options as {
          delete: (
            ctx: { userId: string; tenantId: string; db: unknown },
            strategy: string,
          ) => Promise<undefined | { status: "ok" } | { status: "incomplete"; reason: string }>;
        }
      ).delete = originalUserDelete;
    }
  });

  test("hook incomplete on one tenant, then throws on a later tenant → the incomplete report survives, flagged rolledBack (#1489)", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedMembership(ALICE_ID, TENANT_B);

    const usages = stack.registry.getExtensionUsages("userData");
    const userUsage = usages.find((u) => u.entityName === "user");
    if (!userUsage?.options) throw new Error("user usage not found");
    const originalUserDelete = (
      userUsage.options as {
        delete: (
          ctx: { userId: string; tenantId: string; db: unknown },
          strategy: string,
        ) => Promise<undefined | { status: "ok" } | { status: "incomplete"; reason: string }>;
      }
    ).delete;
    (
      userUsage.options as {
        delete: (
          ctx: { userId: string; tenantId: string; db: unknown },
          strategy: string,
        ) => Promise<undefined | { status: "ok" } | { status: "incomplete"; reason: string }>;
      }
    ).delete = async (ctx: { userId: string; tenantId: string; db: unknown }, strategy: string) => {
      if (ctx.userId === ALICE_ID && ctx.tenantId === TENANT_A) {
        return { status: "incomplete", reason: "synthetic partial cleanup for alice (tenant A)" };
      }
      if (ctx.userId === ALICE_ID && ctx.tenantId === TENANT_B) {
        throw new Error("synthetic hook failure for alice (tenant B)");
      }
      return originalUserDelete(ctx, strategy);
    };

    try {
      const result = await runForgetCleanup({
        db: stack.db,
        registry: stack.registry,
        now: NOW(),
      });

      // The whole per-user sub-tx rolled back — the DB rows (including the
      // status flip) are undone, and the failure surfaces as a hard error
      // too. But tenant A's "incomplete" report describes an external,
      // non-transactional side effect (already ran, not rolled back by a
      // DB rollback) — it must still reach the operator, just marked
      // rolledBack so they know the user itself is still DeletionRequested.
      const aliceIncomplete = result.incomplete.find((i) => i.userId === ALICE_ID);
      expect(aliceIncomplete?.rolledBack).toBe(true);
      expect(result.errors.some((e) => e.userId === ALICE_ID)).toBe(true);
      expect(result.processedUserIds).not.toContain(ALICE_ID);

      const aliceRow = await fetchUser(ALICE_ID);
      expect(aliceRow?.status).toBe(USER_STATUS.DeletionRequested);
    } finally {
      (
        userUsage.options as {
          delete: (
            ctx: { userId: string; tenantId: string; db: unknown },
            strategy: string,
          ) => Promise<undefined | { status: "ok" } | { status: "incomplete"; reason: string }>;
        }
      ).delete = originalUserDelete;
    }
  });

  test("hook returns {status:'ok'} → treated as a clean completion, not incomplete", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);

    const usages = stack.registry.getExtensionUsages("userData");
    const userUsage = usages.find((u) => u.entityName === "user");
    if (!userUsage?.options) throw new Error("user usage not found");
    const originalUserDelete = (
      userUsage.options as {
        delete: (
          ctx: { userId: string; tenantId: string; db: unknown },
          strategy: string,
        ) => Promise<undefined | { status: "ok" } | { status: "incomplete"; reason: string }>;
      }
    ).delete;
    (
      userUsage.options as {
        delete: (
          ctx: { userId: string; tenantId: string; db: unknown },
          strategy: string,
        ) => Promise<undefined | { status: "ok" } | { status: "incomplete"; reason: string }>;
      }
    ).delete = async (ctx: { userId: string; tenantId: string; db: unknown }, strategy: string) => {
      if (ctx.userId === ALICE_ID) {
        return { status: "ok" };
      }
      return originalUserDelete(ctx, strategy);
    };

    try {
      const result = await runForgetCleanup({
        db: stack.db,
        registry: stack.registry,
        now: NOW(),
      });

      expect(result.processedUserIds).toContain(ALICE_ID);
      expect(result.errors.some((e) => e.userId === ALICE_ID)).toBe(false);
      expect(result.incomplete.some((i) => i.userId === ALICE_ID)).toBe(false);

      const aliceRow = await fetchUser(ALICE_ID);
      expect(aliceRow?.status).toBe(USER_STATUS.Deleted);
    } finally {
      (
        userUsage.options as {
          delete: (
            ctx: { userId: string; tenantId: string; db: unknown },
            strategy: string,
          ) => Promise<undefined | { status: "ok" } | { status: "incomplete"; reason: string }>;
        }
      ).delete = originalUserDelete;
    }
  });
});

// eraseKey never fails in the in-memory adapter, so the rollback test
// overrides it to simulate a KMS outage.
class FailingEraseKms extends InMemoryKmsAdapter {
  override async eraseKey(): Promise<void> {
    throw new Error("kms unavailable");
  }
}

describe("runForgetCleanup :: crypto-shredding (subject key erase)", () => {
  test("successful forget erases the user's subject key", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);

    const kms = new InMemoryKmsAdapter();
    await kms.createKey({ kind: "user", userId: ALICE_ID });

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
      kms,
    });

    expect(result.processedUserIds).toEqual([ALICE_ID]);
    expect(result.errors).toHaveLength(0);
    await expect(kms.getKey({ kind: "user", userId: ALICE_ID })).rejects.toThrow(
      "Subject key erased",
    );
  });

  test("user without a subject key: erase is a no-op, forget still completes", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
      kms: new InMemoryKmsAdapter(),
    });

    expect(result.processedUserIds).toEqual([ALICE_ID]);
    expect(result.errors).toHaveLength(0);
  });

  test("eraseKey failure rolls back the user's sub-tx (stays DeletionRequested, PII intact)", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: "alice.erase-fail@example.com",
    });
    await seedMembership(ALICE_ID, TENANT_A);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
      kms: new FailingEraseKms(),
    });

    expect(result.processedUserIds).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]?.message).toContain("kms unavailable");

    // Sub-tx rollback: the anonymize hooks ran but must be undone — a user
    // whose key survives must keep retrying, not sit half-forgotten.
    const alice = await fetchUser(ALICE_ID);
    expect(alice?.status).toBe(USER_STATUS.DeletionRequested);
    expect(alice?.email).toBe("alice.erase-fail@example.com");
  });
});

// The manual operator trigger (agent.risk "high") must erase a real subject key
// through configuredPiiSubjectKms(), not a directly-injected args.kms that bypasses the wrapper.
describe("run-forget-cleanup write handler (manual, risk high) via configuredPiiSubjectKms", () => {
  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("erases the subject key through the gated KMS wrapper", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });
    await seedMembership(ALICE_ID, TENANT_A);

    const kms = new InMemoryKmsAdapter();
    await kms.createKey({ kind: "user", userId: ALICE_ID });
    configurePiiSubjectKms(kms);

    await stack.http.writeOk(UserDataRightsHandlers.runForgetCleanup, {}, TestUsers.systemAdmin);

    const aliceRow = await fetchUser(ALICE_ID);
    expect(aliceRow?.status).toBe(USER_STATUS.Deleted);
    await expect(kms.getKey({ kind: "user", userId: ALICE_ID })).rejects.toThrow(
      "Subject key erased",
    );
  });
});

// user.updated carries the pre-update row in `previous`. With a subject KMS the
// executor encrypts it under the user's key, so the forget run's eraseKey must
// shred every historical copy of the address, including the one an earlier
// email change left behind.
describe("forget shreds user.updated.previous (email change before deletion)", () => {
  const OLD_EMAIL = "alice.old-address@example.com";
  const NEW_EMAIL = "alice.new-address@example.com";
  const DISPLAY_NAME = "Alice Previous Shred";

  const getKms = setupSubjectKmsForTest();

  beforeEach(async () => {
    await resetTestTables(stack.db, [eventsTable]);
  });

  async function loadUserUpdatedPayloads(userId: string): Promise<Record<string, unknown>[]> {
    const events = await selectMany<{ type: string; payload: Record<string, unknown> }>(
      stack.db,
      eventsTable,
      { aggregateId: userId },
    );
    return events.filter((event) => event.type === "user.updated").map((event) => event.payload);
  }

  test("previous.email of an earlier email change is unreadable after the forget run", async () => {
    const { id: userId } = await seedUserViaExecutor(stack.db, {
      email: OLD_EMAIL,
      displayName: DISPLAY_NAME,
      passwordHash: "hashed",
      emailVerified: true,
    });
    await seedMembership(userId, TENANT_A);

    await stack.http.writeOk(
      UserHandlers.update,
      { id: userId, version: 1, changes: { email: NEW_EMAIL } },
      TestUsers.systemAdmin,
    );

    // Positive control: before the erase the key still opens the history.
    const beforeForget = emailsIn(await loadUserUpdatedPayloads(userId), "previous");
    expect(beforeForget).toHaveLength(1);
    const [earlierEmail] = beforeForget;
    if (earlierEmail === undefined) throw new Error("expected one previous email");
    expect(isPiiCiphertext(earlierEmail)).toBe(true);
    expect(await decryptEmail(getKms(), earlierEmail)).toBe(OLD_EMAIL);

    await updateUserLifecycle(stack.db, userId, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
    });

    await stack.http.writeOk(UserDataRightsHandlers.runForgetCleanup, {}, TestUsers.systemAdmin);

    expect((await fetchUser(userId))?.status).toBe(USER_STATUS.Deleted);

    const events = await selectMany(stack.db, eventsTable, { aggregateId: userId });
    const serialized = JSON.stringify(events, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serialized).not.toContain(OLD_EMAIL);
    expect(serialized).not.toContain(NEW_EMAIL);
    expect(serialized).not.toContain(DISPLAY_NAME);

    const payloads = await loadUserUpdatedPayloads(userId);
    const emails = [...emailsIn(payloads, "changes"), ...emailsIn(payloads, "previous")];
    // Email change `previous`, lifecycle update `previous` and anonymization `changes` are ciphertexts.
    expect(emails.filter((email) => isPiiCiphertext(email)).length).toBeGreaterThanOrEqual(3);
    await expectEmailsShredded(emails, getKms(), userId);
  });
});

describe("runForgetCleanup :: user stored before the KMS existed", () => {
  const getKms = setupSubjectKmsForTest();

  beforeEach(async () => {
    await resetTestTables(stack.db, [eventsTable]);
  });

  test("the follow-up writes after eraseKey finish and the update event carries the erased sentinel", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: "legacy-alice@example.com",
      displayName: "Legacy Alice",
    });
    await seedMembership(ALICE_ID, TENANT_A);
    await getKms().eraseKey({ kind: "user", userId: ALICE_ID });

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });

    expect(result.errors).toEqual([]);
    expect(result.processedUserIds).toContain(ALICE_ID);
    expect((await fetchUser(ALICE_ID))?.status).toBe(USER_STATUS.Deleted);
    const events = await selectMany<{ type: string; payload: Record<string, unknown> }>(
      stack.db,
      eventsTable,
      { aggregateId: ALICE_ID },
    );
    const payloads = events.filter((e) => e.type === "user.updated").map((e) => e.payload);
    expect(emailsIn(payloads, "previous")).toContain(PII_ERASED_SENTINEL);
    await expectEmailsShredded(
      [...emailsIn(payloads, "changes"), ...emailsIn(payloads, "previous")],
      getKms(),
      ALICE_ID,
    );
  });
});
