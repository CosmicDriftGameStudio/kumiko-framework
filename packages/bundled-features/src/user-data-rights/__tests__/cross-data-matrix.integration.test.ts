// Cross-Data-Matrix Integration-Test (S2.T1).
//
// Pinst dass eine App-eigene Domain-Entity ueber EXT_USER_DATA sauber in
// Export- + Forget-Pipeline integriert. Synthetic "note"-Entity steht
// stellvertretend fuer "Chat-Message", "Blog-Post", "Order-Line" etc.
//
// Matrix:
//   - Export bundelt user + fileRef + note (3 Provider-Features) cross-
//     tenant fuer einen User.
//   - Forget cleant user (anonymized) + fileRef (deleted) + note
//     (deleted) cross-tenant fuer denselben User.
//   - Other-User-Isolation: Bobs notes/files bleiben unangetastet bei
//     Alices Forget; Bobs Daten landen NICHT in Alices Export-Bundle.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineFeature,
  EXT_USER_DATA,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createFilesFeature } from "../../files";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults";
import { createUserDataRightsFeature } from "../feature";
import { runForgetCleanup } from "../run-forget-cleanup";
import { runUserExport } from "../run-user-export";

let stack: TestStack;

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";
const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";

function uuid(suffix: number): string {
  return `cccccccc-cccc-4ccc-8ccc-${suffix.toString(16).padStart(12, "0")}`;
}

const ALICE_ID = uuid(1);
const BOB_ID = uuid(2);

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const NOW = (): Instant => getTemporal().Now.instant();
const PAST = (): Instant => getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);

// Synthetic third-party Domain-Feature: "note" mit export- + delete-Hook.
// Stellvertretend fuer App-spezifische Entities (Chat-Message, Blog-Post
// etc.), die ueber EXT_USER_DATA sauber in die Pipeline integrieren.
const exportNotes: UserDataExportHook = async (ctx) => {
  const result = await asRawClient(ctx.db).unsafe(
    `
    SELECT id, title, body
    FROM test_notes
    WHERE tenant_id = $1 AND author_id = $2
  `,
    [ctx.tenantId, ctx.userId],
  );
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  const rows = ((result as any).rows ?? result) as Array<{
    id: string;
    title: string;
    body: string;
  }>;
  if (rows.length === 0) return null;
  return {
    entity: "note",
    rows: rows.map((r) => ({ id: r.id, title: r.title, body: r.body })),
  };
};

const deleteNotes: UserDataDeleteHook = async (ctx, _strategy) => {
  await asRawClient(ctx.db).unsafe(
    `
    DELETE FROM test_notes
    WHERE tenant_id = $1 AND author_id = $2
  `,
    [ctx.tenantId, ctx.userId],
  );
};

const testNotesFeature = defineFeature("test-notes", (r) => {
  r.useExtension(EXT_USER_DATA, "note", {
    export: exportNotes,
    delete: deleteNotes,
  });
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
      testNotesFeature,
    ],
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
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
  await asRawClient(stack.db).unsafe(`
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
  await asRawClient(stack.db).unsafe(`
    CREATE TABLE IF NOT EXISTS test_notes (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      author_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL
    )
  `);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_memberships`);
  await asRawClient(stack.db).unsafe(`DELETE FROM file_refs`);
  await asRawClient(stack.db).unsafe(`DELETE FROM test_notes`);
});

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
  userId: string,
  name: string,
): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `
    INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
    VALUES ($1, $2, $3, $4, 'application/pdf', 1024, $5)
  `,
    [id, tenantId, `storage/${id}`, name, userId],
  );
}

async function seedNote(
  id: string,
  tenantId: string,
  userId: string,
  title: string,
): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `
    INSERT INTO test_notes (id, tenant_id, author_id, title, body)
    VALUES ($1, $2, $3, $4, $5)
  `,
    [id, tenantId, userId, title, `body for ${title}`],
  );
}

async function fetchNotes(tenantId: string, userId: string): Promise<unknown[]> {
  const result = await asRawClient(stack.db).unsafe(
    `
    SELECT id, title FROM test_notes WHERE tenant_id = $1 AND author_id = $2
  `,
    [tenantId, userId],
  );
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  return ((result as any).rows ?? result) as unknown[];
}

describe("Cross-Data-Matrix :: Export bundelt 3 Provider-Features (user + fileRef + note)", () => {
  test("Alice (Tenant A + B) → Bundle hat alle 3 Entitaeten cross-tenant", async () => {
    await seedUser(ALICE_ID, { email: "alice@example.com", displayName: "Alice" });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedMembership(ALICE_ID, TENANT_B);

    await seedFileRef(uuid(101), TENANT_A, ALICE_ID, "alice-a.pdf");
    await seedFileRef(uuid(102), TENANT_B, ALICE_ID, "alice-b.pdf");

    await seedNote(uuid(201), TENANT_A, ALICE_ID, "note-A-1");
    await seedNote(uuid(202), TENANT_A, ALICE_ID, "note-A-2");
    await seedNote(uuid(203), TENANT_B, ALICE_ID, "note-B-1");

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: ALICE_ID,
      now: NOW(),
    });

    expect(bundle.tenants).toHaveLength(2);

    const tenantA = bundle.tenants.find((t) => t.tenantId === TENANT_A);
    const tenantB = bundle.tenants.find((t) => t.tenantId === TENANT_B);
    expect(tenantA).toBeDefined();
    expect(tenantB).toBeDefined();

    // Tenant A: user + fileRef + 2 notes
    const entitiesA = (tenantA?.entities ?? []).map((e) => e.entity);
    expect(entitiesA).toContain("user");
    expect(entitiesA).toContain("fileRef");
    expect(entitiesA).toContain("note");
    const noteSnippetA = tenantA?.entities.find((e) => e.entity === "note");
    expect(noteSnippetA?.rows).toHaveLength(2);

    // Tenant B: user + fileRef + 1 note
    const noteSnippetB = tenantB?.entities.find((e) => e.entity === "note");
    expect(noteSnippetB?.rows).toHaveLength(1);
    expect(String(noteSnippetB?.rows[0]?.["title"])).toBe("note-B-1");
  });

  test("Other-User-Isolation: Bobs notes nicht in Alices Bundle", async () => {
    await seedUser(ALICE_ID, { email: "alice@example.com" });
    await seedUser(BOB_ID, { email: "bob@example.com" });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedMembership(BOB_ID, TENANT_A);

    await seedNote(uuid(301), TENANT_A, ALICE_ID, "alice-secret");
    await seedNote(uuid(302), TENANT_A, BOB_ID, "bob-secret");

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: ALICE_ID,
      now: NOW(),
    });

    const serialized = JSON.stringify(bundle);
    expect(serialized).toContain("alice-secret");
    expect(serialized).not.toContain("bob-secret");
  });
});

describe("Cross-Data-Matrix :: Forget cleant 3 Provider-Features cross-tenant", () => {
  test("Alice DeletionRequested + grace expired → notes weg in beiden Tenants, Bobs Daten unangetastet", async () => {
    await seedUser(ALICE_ID, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: PAST(),
      email: "alice@example.com",
    });
    await seedUser(BOB_ID, { email: "bob@example.com" });
    await seedMembership(ALICE_ID, TENANT_A);
    await seedMembership(ALICE_ID, TENANT_B);
    await seedMembership(BOB_ID, TENANT_A);

    await seedFileRef(uuid(401), TENANT_A, ALICE_ID, "alice-a.pdf");
    await seedFileRef(uuid(402), TENANT_A, BOB_ID, "bob-a.pdf");
    await seedNote(uuid(501), TENANT_A, ALICE_ID, "alice-A");
    await seedNote(uuid(502), TENANT_B, ALICE_ID, "alice-B");
    await seedNote(uuid(503), TENANT_A, BOB_ID, "bob-A");

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });

    expect(result.processedUserIds).toContain(ALICE_ID);
    expect(result.errors).toHaveLength(0);

    // Alices notes in beiden Tenants weg
    expect(await fetchNotes(TENANT_A, ALICE_ID)).toHaveLength(0);
    expect(await fetchNotes(TENANT_B, ALICE_ID)).toHaveLength(0);

    // Alices fileRef in Tenant A weg
    const aliceFiles = await asRawClient(stack.db).unsafe(
      `
      SELECT id FROM file_refs WHERE tenant_id = $1 AND inserted_by_id = $2
    `,
      [TENANT_A, ALICE_ID],
    );
    // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
    expect((((aliceFiles as any).rows ?? aliceFiles) as unknown[]).length).toBe(0);

    // Bobs notes + files unangetastet
    expect(await fetchNotes(TENANT_A, BOB_ID)).toHaveLength(1);
    const bobFiles = await asRawClient(stack.db).unsafe(
      `
      SELECT id FROM file_refs WHERE tenant_id = $1 AND inserted_by_id = $2
    `,
      [TENANT_A, BOB_ID],
    );
    // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
    expect((((bobFiles as any).rows ?? bobFiles) as unknown[]).length).toBe(1);

    // Alice-User-Row anonymisiert (DSGVO-Kern: PII raus, Sentinel-Email).
    const aliceRow = await asRawClient(stack.db).unsafe(
      `
      SELECT email, status FROM read_users WHERE id = $1
    `,
      [ALICE_ID],
    );
    // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
    const aliceRows = ((aliceRow as any).rows ?? aliceRow) as Array<{
      email: string;
      status: string;
    }>;
    expect(aliceRows[0]?.status).toBe(USER_STATUS.Deleted);
    expect(aliceRows[0]?.email).toMatch(/^deleted-.*@anonymized\.invalid$/);
    expect(aliceRows[0]?.email).not.toContain("alice@example.com");
  });
});
