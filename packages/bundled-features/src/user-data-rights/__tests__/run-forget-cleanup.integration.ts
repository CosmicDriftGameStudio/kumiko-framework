// Forget-Cleanup-Runner Integration-Test (S2.U5b).
//
// User-Explicit-Anforderung "nach Löschfrist sollte es keine Daten mehr
// haben + Cross-Data-Matrix": Dieser Test fuehrt den Pipeline-Lauf aus
// und beweist:
//   - Abgelaufene Grace + DeletionRequested → User-Row anonymisiert,
//     status=Deleted, alle file_refs des Users in ALLEN Tenants weg.
//   - Cross-Tenant: Alice in Tenant A + B, Forget triggert Hook-Iteration
//     ueber beide Memberships.
//   - Future-Grace: User mit gracePeriodEnd > now bleibt unangetastet.
//   - Other-User-Isolation: Bob (active) keine Daten verloren.
//   - Idempotent: zweiter Run ist no-op.
//
// Strategy-Mapping (retention.strategy → UserDataDeleteStrategy) ist im
// Unit-Test pinned (policy-to-strategy.test.ts), nicht hier. Hier nur
// der end-to-end-Default-Pfad (delete).

import {
  createEntityTable,
  setupTestStack,
  type TestStack,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createFilesFeature } from "../../files";
import {
  createUserFeature,
  USER_ANONYMIZED_DISPLAY_NAME,
  USER_DELETED_DISPLAY_NAME,
  USER_STATUS,
  userEntity,
  userTable,
} from "../../user";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults";
import { createUserDataRightsFeature } from "../feature";
import { runForgetCleanup } from "../run-forget-cleanup";

let stack: TestStack;

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";
const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";

// Deterministische UUIDs fuer Tests — gleiche Helper wie in
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
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
  });

  await createEntityTable(stack.db, userEntity);
  await createEntityTable(stack.db, tenantRetentionOverrideEntity);
  // tenant-membership-Tabelle (von tenant-feature) manuell anlegen weil
  // wir ohne tenant-feature im stack arbeiten — minimaler Setup.
  await stack.db.execute(sql`
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
  await stack.db.execute(sql`
    CREATE TABLE IF NOT EXISTS file_refs (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      storage_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      field_name TEXT,
      inserted_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      inserted_by_id TEXT
    )
  `);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(userTable);
  await stack.db.execute(sql`DELETE FROM read_tenant_memberships`);
  await stack.db.execute(sql`DELETE FROM file_refs`);
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
  await stack.db.insert(userTable).values({
    id,
    tenantId: TENANT_SYSTEM,
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
  await stack.db.execute(sql`
    INSERT INTO read_tenant_memberships (tenant_id, user_id, roles)
    VALUES (${tenantId}, ${userId}, '["Member"]')
    ON CONFLICT (user_id, tenant_id) DO NOTHING
  `);
}

async function seedFileRef(
  id: string,
  tenantId: string,
  insertedById: string | null,
  fileName: string,
): Promise<void> {
  await stack.db.execute(sql`
    INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
    VALUES (${id}, ${tenantId}, ${`storage/${id}`}, ${fileName}, 'application/pdf', 1024, ${insertedById})
    ON CONFLICT (id) DO NOTHING
  `);
}

async function fetchUser(id: string): Promise<{
  email: string;
  display_name: string;
  password_hash: string | null;
  status: string;
  deleted_at: string | null;
} | null> {
  const result = await stack.db.execute(sql`
    SELECT email, display_name, password_hash, status, deleted_at
    FROM read_users WHERE id = ${id}
  `);
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
  const result = await stack.db.execute(sql`
    SELECT id, file_name, inserted_by_id
    FROM file_refs WHERE tenant_id = ${tenantId} AND inserted_by_id = ${userId}
  `);
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  return ((result as any).rows ?? result) as unknown[];
}

async function fetchAllFileRefs(tenantId: string): Promise<unknown[]> {
  const result = await stack.db.execute(sql`
    SELECT id, file_name, inserted_by_id FROM file_refs WHERE tenant_id = ${tenantId}
  `);
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  return ((result as any).rows ?? result) as unknown[];
}

describe("runForgetCleanup :: happy path (Cross-Tenant Account-Deletion)", () => {
  test("Alice (DeletionRequested + grace expired) → user anonymized + files weg in beiden Tenants", async () => {
    // Alice in Tenant A + B, mit files in beiden.
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

    // Bob (active) als Negative-Control mit eigenen files — sollen NICHT
    // angetastet werden.
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
    // userDeleteHook setzt email/displayName auf Pseudonyme (siehe
    // user-data-rights-defaults/hooks/user.userdata-hook). Pruefen dass
    // ORIGINAL-PII raus ist — das ist der harte DSGVO-Punkt.
    expect(aliceRow?.email).not.toContain("alice@example.com");
    expect(aliceRow?.email).toContain("anonymized.invalid");
    expect([USER_DELETED_DISPLAY_NAME, USER_ANONYMIZED_DISPLAY_NAME]).toContain(
      aliceRow?.display_name,
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
    // Keine User mehr im DeletionRequested-Status nach Run 1 → Run 2
    // findet nichts.
    expect(secondRun.processedUserIds).toEqual([]);
    expect(secondRun.hookCallsAttempted).toBe(0);
  });
});

describe("runForgetCleanup :: PII-Audit nach Cleanup", () => {
  test("nach Cleanup ist KEINE Original-PII (email + displayName) mehr in DB", async () => {
    // Cross-Data-Matrix-Check: simulieren dass mehrere Datenpunkte mit
    // Alice's Identity verbunden sind, danach beweisen dass keine
    // davon ihre Original-Werte traegt.
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

    // Cross-Tabellen-PII-Check: koennen wir noch IRGENDWO Original-Werte finden?
    const userRows = await stack.db.execute(sql`
      SELECT id FROM read_users WHERE email = ${ORIGINAL_EMAIL} OR display_name = ${ORIGINAL_NAME}
    `);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
    const userMatches = (userRows as any).rows ?? userRows;
    expect(userMatches).toHaveLength(0);

    const fileRows = await fetchAllFileRefs(TENANT_A);
    expect(fileRows).toHaveLength(0);
  });
});
