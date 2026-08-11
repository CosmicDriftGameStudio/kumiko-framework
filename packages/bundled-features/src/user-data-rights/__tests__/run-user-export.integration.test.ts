// User-Data-Export Integration-Test (S2.U3).
//
// User-Explicit-Anforderung "alle daten enthalten, ES + files; PII
// check in daten; alle wichtigen cross data matrix checks".
//
// Pinst:
//   - Bundle enthaelt user-Profil + fileRefs aller Tenant-Memberships
//     (Cross-Tenant zusammengefuehrt in einem Output).
//   - PII-Surface: passwordHash + roles + status sind NICHT im Bundle
//     (User-Hook-Selektion).
//   - File-Binaries kommen NICHT inline — nur Stueckliste mit
//     storageKey + fileName (ZIP-Bau ist optional Async-Wrap).
//   - Other-User-Isolation: Bobs Files nicht in Alices Bundle.
//   - Orphan-User (0 Memberships): user-Profil-Hook laeuft trotzdem
//     ueber Pseudo-Tenant.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  encryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type UserDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  resetTestTables,
  seedRow,
} from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { configValueEntity, createConfigFeature } from "../../config";
import { createDataRetentionFeature } from "../../data-retention";
import { createFilesFeature } from "../../files";
import { createSessionsFeature, userSessionEntity } from "../../sessions";
import { createTenantFeature, tenantInvitationEntity, tenantInvitationsTable } from "../../tenant";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults";
import { tenantInvitationExportHook } from "../../user-data-rights-defaults/hooks/tenant-invitation.userdata-hook";
import { createUserDataRightsFeature } from "../feature";
import { runUserExport } from "../run-user-export";

let stack: TestStack;

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";
const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";

function uuid(suffix: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${suffix.toString(16).padStart(12, "0")}`;
}

const ALICE_ID = uuid(1);
const BOB_ID = uuid(2);
const ORPHAN_ID = uuid(3);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createConfigFeature(),
      createTenantFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafeCreateEntityTable(stack.db, configValueEntity);
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
  await resetTestTables(stack.db, [
    userTable,
    "read_tenant_memberships",
    fileRefsTable,
    tenantInvitationsTable,
  ]);
});

const NOW = () => getTemporal().Now.instant();

async function seedUser(
  id: string,
  overrides: { email?: string; displayName?: string; roles?: string } = {},
): Promise<void> {
  await seedRow(stack.db, userTable, {
    id,
    tenantId: TENANT_SYSTEM,
    email: overrides.email ?? `user-${id}@example.com`,
    passwordHash: "secret-hash-must-not-leak",
    displayName: overrides.displayName ?? `User ${id}`,
    locale: "de",
    emailVerified: true,
    roles: overrides.roles ?? '["Member","SecretRole"]',
    status: USER_STATUS.Active,
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

describe("runUserExport :: alle Daten enthalten + Cross-Tenant", () => {
  test("Alice in Tenant A + B → Bundle hat user-Profil + fileRefs aus beiden Tenants", async () => {
    await seedUser(ALICE_ID, {
      email: "alice@example.com",
      displayName: "Alice Test",
    });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedMembership(ALICE_ID, TENANT_B);
    await seedFileRef(uuid(101), TENANT_A, ALICE_ID, "alice-a-1.pdf");
    await seedFileRef(uuid(102), TENANT_A, ALICE_ID, "alice-a-2.pdf");
    await seedFileRef(uuid(103), TENANT_B, ALICE_ID, "alice-b-1.pdf");

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: ALICE_ID,
      now: NOW(),
    });

    expect(bundle.userId).toBe(ALICE_ID);
    expect(bundle.tenants).toHaveLength(2);

    // user-Entity in beiden Tenant-Sections (Hook ist tenant-agnostisch
    // und liefert dasselbe Profil — das ist OK fuer den export-pfad,
    // App-Author kann Bundle pro Tenant trennen wenn gewuenscht).
    const tenantA = bundle.tenants.find((t) => t.tenantId === TENANT_A);
    expect(tenantA).toBeDefined();
    const userSnippet = tenantA?.entities.find((e) => e.entity === "user");
    expect(userSnippet).toBeDefined();
    expect(userSnippet?.rows).toHaveLength(1);
    expect(String(userSnippet?.rows[0]?.["email"])).toBe("alice@example.com");
    expect(String(userSnippet?.rows[0]?.["displayName"])).toBe("Alice Test");

    // fileRefs cross-tenant: 2 in A, 1 in B → 4 Snippet-Eintraege
    // (2× user + 2× fileRef-Entries) und Flat-fileRefs hat 4 Eintraege
    // total (2 in A + 1 in B = 3 ist falsch — die fileRef-Hook listet
    // pro Tenant → also 2 + 1 = 3 fileRefs flat).
    expect(bundle.fileRefs).toHaveLength(3);
    const fileNamesA = bundle.fileRefs
      .filter((f) => f.tenantId === TENANT_A)
      .map((f) => f.fileName);
    expect(fileNamesA).toContain("alice-a-1.pdf");
    expect(fileNamesA).toContain("alice-a-2.pdf");
    const fileNamesB = bundle.fileRefs
      .filter((f) => f.tenantId === TENANT_B)
      .map((f) => f.fileName);
    expect(fileNamesB).toContain("alice-b-1.pdf");
  });
});

describe("runUserExport :: PII-Surface (Datenschutz-Audit)", () => {
  test("Bundle enthaelt KEIN passwordHash + KEIN roles + KEIN status", async () => {
    await seedUser(ALICE_ID, {
      roles: '["Member","SecretAdmin","HiddenRole"]',
    });
    await seedMembership(ALICE_ID, TENANT_A);

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: ALICE_ID,
      now: NOW(),
    });

    // Roundtrip durch JSON.stringify — auch wenn ein Hook das Feld
    // versehentlich exposed, faellt es hier auf.
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("secret-hash-must-not-leak");
    expect(serialized).not.toContain("SecretAdmin");
    expect(serialized).not.toContain("HiddenRole");

    // Strukturell pruefen: user-Profil-Row hat keine privileged-Felder.
    const userSnippet = bundle.tenants[0]?.entities.find((e) => e.entity === "user");
    const profile = userSnippet?.rows[0];
    expect(profile?.["passwordHash"]).toBeUndefined();
    expect(profile?.["roles"]).toBeUndefined();
    expect(profile?.["status"]).toBeUndefined();
  });
});

describe("runUserExport :: Cross-User-Isolation", () => {
  test("Alice's Bundle enthaelt KEINE Daten von Bob (gleicher Tenant, andere insertedById)", async () => {
    await seedUser(ALICE_ID, { email: "alice@example.com" });
    await seedUser(BOB_ID, { email: "bob.distinct@example.com" });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedMembership(BOB_ID, TENANT_A);
    // Beide haben Files im selben Tenant.
    await seedFileRef(uuid(201), TENANT_A, ALICE_ID, "alice-private.pdf");
    await seedFileRef(uuid(202), TENANT_A, BOB_ID, "bob-private.pdf");

    const aliceBundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: ALICE_ID,
      now: NOW(),
    });

    const aliceFileNames = aliceBundle.fileRefs.map((f) => f.fileName);
    expect(aliceFileNames).toContain("alice-private.pdf");
    expect(aliceFileNames).not.toContain("bob-private.pdf");

    // user-Profil enthaelt ALICE's email, nicht Bobs.
    const userRow = aliceBundle.tenants[0]?.entities.find((e) => e.entity === "user")?.rows[0];
    expect(String(userRow?.["email"])).toBe("alice@example.com");
    expect(JSON.stringify(aliceBundle)).not.toContain("bob.distinct@example.com");
  });
});

describe("runUserExport :: Orphan-User (0 Memberships)", () => {
  test("User ohne Memberships → user-Profil trotzdem im Bundle (Pseudo-Tenant)", async () => {
    await seedUser(ORPHAN_ID, { email: "orphan@example.com" });
    // KEINE seedMembership.

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: ORPHAN_ID,
      now: NOW(),
    });

    expect(bundle.tenants).toHaveLength(1);
    const orphanSection = bundle.tenants[0];
    const userSnippet = orphanSection?.entities.find((e) => e.entity === "user");
    expect(userSnippet?.rows).toHaveLength(1);
    expect(String(userSnippet?.rows[0]?.["email"])).toBe("orphan@example.com");
  });
});

describe("runUserExport :: Empty-State", () => {
  test("User existiert nicht → leeres Bundle ohne Error", async () => {
    // KEIN seedUser — der user-Hook returnt null wenn nichts da ist.
    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: ORPHAN_ID,
      now: NOW(),
    });

    // Orphan-Path laeuft trotzdem (Hook returnt null → kein Snippet).
    expect(bundle.userId).toBe(ORPHAN_ID);
    expect(bundle.fileRefs).toEqual([]);
    // Der user-Hook gibt `null` zurueck → keine entities-Section.
    const allUserSnippets = bundle.tenants.flatMap((t) =>
      t.entities.filter((e) => e.entity === "user"),
    );
    expect(allUserSnippets).toEqual([]);
  });
});

describe("runUserExport :: PII-Subject-Ciphertexte (#820)", () => {
  test("Art. 20: bundle carries plaintext, never kumiko-pii: blobs", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    try {
      await seedUser(ALICE_ID, { email: "alice.kms@example.com", displayName: "Alice KMS" });
      await seedMembership(ALICE_ID, TENANT_A);
      // Read-Pfad-Test: die Spalten tragen echten Subject-Ciphertext, wie
      // sie ein Executor-Write hinterlassen haette (Write-Pfad: PR 1/2).
      const encrypted = await encryptPiiFieldValues(
        { id: ALICE_ID, email: "alice.kms@example.com", displayName: "Alice KMS" },
        userEntity,
        ["email", "displayName"],
        kms,
        { requestId: "test" },
      );
      await asRawClient(stack.db).unsafe(
        `UPDATE read_users SET email = $1, display_name = $2 WHERE id = $3`,
        [String(encrypted["email"]), String(encrypted["displayName"]), ALICE_ID],
      );

      const bundle = await runUserExport({
        db: stack.db,
        registry: stack.registry,
        userId: ALICE_ID,
        now: NOW(),
      });

      const json = JSON.stringify(bundle);
      expect(json).not.toContain("kumiko-pii:");
      expect(json).toContain("alice.kms@example.com");
      expect(json).toContain("Alice KMS");
    } finally {
      resetPiiSubjectKmsForTests();
    }
  });

  test("ciphertext without a configured KMS exports an explicit marker, not the blob", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    await seedUser(ALICE_ID, { email: "alice.nokms@example.com" });
    await seedMembership(ALICE_ID, TENANT_A);
    const encrypted = await encryptPiiFieldValues(
      { id: ALICE_ID, email: "alice.nokms@example.com" },
      userEntity,
      ["email"],
      kms,
      { requestId: "test" },
    );
    await asRawClient(stack.db).unsafe(`UPDATE read_users SET email = $1 WHERE id = $2`, [
      String(encrypted["email"]),
      ALICE_ID,
    ]);
    resetPiiSubjectKmsForTests();

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: ALICE_ID,
      now: NOW(),
    });
    const json = JSON.stringify(bundle);
    expect(json).not.toContain("kumiko-pii:");
    expect(json).toContain("[encrypted:unavailable]");
  });
});

describe("runUserExport :: tenant-invitation PII export (#1937)", () => {
  const BIDX_KEY = Buffer.alloc(32, 9).toString("base64");
  const INVITE_EMAIL = "alice.invite@example.com";

  afterEach(() => {
    resetPiiSubjectKmsForTests();
    resetBlindIndexKeyForTests();
  });

  test("tenant-invitation export snippet contains plaintext email even though the hook does not decrypt locally", async () => {
    // KMS + bidx MUST be configured before the executor write so the row
    // lands encrypted with a real blind index, matching the KMS-active
    // production shape (order matches anonymous-deletion-kms.integration.test.ts).
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    configureBlindIndexKey(BIDX_KEY);

    await seedUser(ALICE_ID, { email: INVITE_EMAIL, displayName: "Alice Invite" });
    await seedMembership(ALICE_ID, TENANT_A);

    // Real executor write path — the same one tenantInvitationExportHook's
    // sibling delete hook and the invite-create handler use — so the row
    // carries genuine ciphertext + a real email_bidx, not a hand-seeded stand-in.
    const invitationExecutor = createEventStoreExecutor(
      tenantInvitationsTable,
      tenantInvitationEntity,
      {
        entityName: "tenant-invitation",
      },
    );
    const systemUser = createSystemUser(TENANT_A);
    const tenantDb = createTenantDb(stack.db, TENANT_A, "system");
    const createResult = await invitationExecutor.create(
      {
        email: INVITE_EMAIL,
        role: "Member",
        status: "pending",
        invitedBy: ALICE_ID,
        expiresAt: NOW().add({ seconds: 7 * 24 * 60 * 60 }),
      },
      systemUser,
      tenantDb,
    );
    expect(createResult.isSuccess).toBe(true);
    const invitationId = (createResult as { data: { id: string } }).data.id;

    const rawRows = await asRawClient(stack.db).unsafe<Record<string, unknown>>(
      `SELECT email, email_bidx FROM read_tenant_invitations WHERE id = $1`,
      [invitationId],
    );
    expect(isPiiCiphertext(rawRows[0]?.["email"])).toBe(true);
    expect(String(rawRows[0]?.["email_bidx"])).toStartWith("kumiko-bidx:v1:");

    // Pins the hook boundary directly: tenantInvitationExportHook itself must
    // hand back ciphertext, not plaintext — decryption is the central sweep's
    // job (decryptSnippetFields in run-user-export.ts), not the hook's. If the
    // hook ever started decrypting locally, this assertion would catch it even
    // though the runUserExport() assertion below would stay green either way.
    const hookCtx: UserDataHookCtx = {
      db: stack.db,
      registry: stack.registry,
      tenantId: TENANT_A,
      userId: ALICE_ID,
    };
    const rawSnippet = await tenantInvitationExportHook(hookCtx);
    expect(isPiiCiphertext(rawSnippet?.rows[0]?.["email"])).toBe(true);

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: ALICE_ID,
      now: NOW(),
    });

    const tenantA = bundle.tenants.find((t) => t.tenantId === TENANT_A);
    expect(tenantA).toBeDefined();
    // Critical check: the entity-name-keyed selectMany lookup must actually
    // find the row via the blind-index OR-branch — a silent miss here would
    // mean the hook found nothing and the bidx hypothesis is wrong.
    const invitationSnippet = tenantA?.entities.find((e) => e.entity === "tenant-invitation");
    expect(invitationSnippet).toBeDefined();
    expect(invitationSnippet?.rows).toHaveLength(1);
    expect(invitationSnippet?.rows[0]?.["email"]).toBe(INVITE_EMAIL);
  });
});
