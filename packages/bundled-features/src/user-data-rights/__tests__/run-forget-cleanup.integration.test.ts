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

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
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
      createSessionsFeature(),

      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  // tenant-membership-Tabelle (von tenant-feature) manuell anlegen weil
  // wir ohne tenant-feature im stack arbeiten — minimaler Setup.
  await asRawClient(stack.db).unsafe(`
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
  // fileRef ist buildEntityTable-getrieben (softDelete) — echte Entity-Tabelle
  // pushen statt hand-CREATE, damit is_deleted/deleted_at/deleted_by_id da sind.
  await unsafePushTables(stack.db, { fileRefsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, "read_tenant_memberships", fileRefsTable]);
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
  await insertOne(stack.db, userTable, {
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
  await asRawClient(stack.db).unsafe(
    `
    INSERT INTO read_tenant_memberships (tenant_id, user_id, roles)
    VALUES ($1, $2, '["Member"]')
    ON CONFLICT (user_id, tenant_id) DO NOTHING
  `,
    [tenantId, userId],
  );
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
  // Advisor-Finding S2.U5b.fix1: vor dem Fix flippte der orphan-Pfad
  // status=Deleted ohne userDeleteHook → email/displayName/passwordHash
  // blieben original. "Sah compliant aus, war es nicht."
  test("User ohne Memberships → trotzdem PII anonymisiert (kein leerer status-Flip)", async () => {
    const ORIGINAL_EMAIL = "orphan.unique@example.com";
    const ORIGINAL_NAME = "Orphan Original";
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: instantFromOffsetMs(-60 * 1000),
      email: ORIGINAL_EMAIL,
      displayName: ORIGINAL_NAME,
    });
    // KEINE seedMembership-Aufrufe — User ist orphan.

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });

    expect(result.processedUserIds).toContain(ALICE_ID);
    expect(result.errors).toEqual([]);

    const aliceRow = await fetchUser(ALICE_ID);
    expect(aliceRow?.status).toBe(USER_STATUS.Deleted);
    // Harter PII-Check: Original-Werte sind weg, Pseudonyme sind drin.
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
    // PRE-tx-Cache: Original-Email gereicht, NICHT die anonymized-Version
    // die der user-Hook waehrend der Tx setzt.
    expect(calls[0]?.userEmail).toBe(ORIGINAL_EMAIL);
    // Cross-Tenant-Beweis: callback bekommt beide Tenants.
    expect(calls[0]?.tenantIds).toHaveLength(2);
    expect(calls[0]?.tenantIds).toContain(TENANT_A);
    expect(calls[0]?.tenantIds).toContain(TENANT_B);
    expect(calls[0]?.executedAt).toBeTruthy();

    // Anonymisierung lief trotzdem durch (Callback ist nach success).
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
      // Kern-Aussage: failed-Sub-Tx → keine Notification (sonst kommen
      // Email-Versendungen fuer User die *nicht* tatsaechlich geloescht
      // wurden, was DSGVO-Mismatch zwischen User-Erwartung + DB-State
      // verursacht).
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
    // Asymmetrie-Schutz analog request-deletion (Atom 5b): wenn sendEmail
    // fuer User A throwt, Batch-Cleanup laeuft fuer User B weiter. Der
    // erste User wurde bereits geloescht (Sub-Tx committed), Throw waere
    // ein Bug — r.job-Wrap markiert den Run failed, retry findet keine
    // expired-User mehr (alle Deleted) → silent miss.
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

    // Beide User wurden processed — Throw bei Alice hat Bob nicht
    // mitgerissen. Beweis dass try/catch das Bubbling stoppt.
    expect(result.processedUserIds).toContain(ALICE_ID);
    expect(result.processedUserIds).toContain(BOB_ID);
    expect(result.errors).toEqual([]);

    // Beide Callbacks angerufen.
    expect(calls.map((c) => c.userId).sort()).toEqual([ALICE_ID, BOB_ID].sort());

    // Beide DB-Rows tatsaechlich geloescht (callback-throw hat den
    // Cleanup nicht zurueckgerollt — Sub-Tx ist VOR dem callback-call
    // committed).
    expect((await fetchUser(ALICE_ID))?.status).toBe(USER_STATUS.Deleted);
    expect((await fetchUser(BOB_ID))?.status).toBe(USER_STATUS.Deleted);
  });

  test("User ohne email-Field (NULL) → callback NICHT gefeuert (skip ohne crash)", async () => {
    // Edge-Case: Email-Spalte ist NULL (kann passieren wenn user-Hook in
    // einem vorigen Run schon anonymisiert hat aber status haengen blieb,
    // oder durch external Migration). Skip schuetzt vor crashing-callback
    // mit invaliden Args.
    await insertOne(stack.db, userTable, {
      id: ALICE_ID,
      tenantId: TENANT_SYSTEM,
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
  // Pinst die load-bearing Property: ein failing Hook bei User A darf
  // nicht User B mit zurueckrollen. Wenn jemand die Sub-Tx in
  // run-forget-cleanup.ts wieder rausnimmt, faellt dieser Test um.
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

    // Failing Hook der nur fuer Alice wirft. Wir injizieren ihn
    // ueber eine eigene Pseudo-Extension-Usage in der Registry.
    // (registry.getExtensionUsages liefert Liste — wir nutzen einen
    // Spy am ersten existierenden Hook.)
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

      // Bob durchgegangen, Alice nicht.
      expect(result.processedUserIds).toContain(BOB_ID);
      expect(result.processedUserIds).not.toContain(ALICE_ID);
      expect(result.errors.some((e) => e.userId === ALICE_ID)).toBe(true);

      // Alice unverändert (Sub-Tx zurueckgerollt → Original-PII intakt,
      // status weiter DeletionRequested damit naechster Run retried).
      const aliceRow = await fetchUser(ALICE_ID);
      expect(aliceRow?.status).toBe(USER_STATUS.DeletionRequested);
      expect(aliceRow?.email).toBe(ORIGINAL_A_EMAIL);

      // Bob anonymisiert + Deleted.
      const bobRow = await fetchUser(BOB_ID);
      expect(bobRow?.status).toBe(USER_STATUS.Deleted);
      expect(bobRow?.email).not.toBe(ORIGINAL_B_EMAIL);
      expect(bobRow?.email).toContain("anonymized.invalid");

      // Error-Detail traegt den richtigen Tenant + Entity-Namen
      // (advisor-Finding: vorher waren das "<sub-transaction>"-Pseudos).
      const aliceError = result.errors.find((e) => e.userId === ALICE_ID);
      expect(aliceError?.tenantId).toBe(TENANT_A);
      expect(aliceError?.entityName).toBe("user");
    } finally {
      // Hook-Spy zuruecksetzen damit andere Tests im selben File nicht
      // davon betroffen sind. (beforeEach cleared eh die DB; aber die
      // Registry ist ueber alle Tests dieselbe.)
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
});
