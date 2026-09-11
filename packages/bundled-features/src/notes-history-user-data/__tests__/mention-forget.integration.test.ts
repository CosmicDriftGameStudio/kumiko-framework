// notes-history mention-forget cascade (fw#2787):
//
//   - a note carrying a structured @-mention on a forgotten user S has its
//     `body` (Row-Subject, personal: { of: "id" }) crypto-shredded when S's
//     Art. 17 forget runs (runForgetCleanup → noteEntryDeleteHook →
//     note-mention lookup → kms.eraseKey on the note's own record subject)
//   - a sibling note on the SAME host with NO mention on S stays fully
//     readable — proves the cascade doesn't collaterally shred every note
//   - the host entity's retention strategy is consulted BEFORE shredding:
//     an `anonymize` override on the host blocks the erase entirely

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  seedRow,
} from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { tenantRetentionOverrideTable } from "../../data-retention/schema/tenant-retention-override";
import { createFilesFeature } from "../../files";
import {
  createNotesHistoryFeature,
  NotesHistoryHandlers,
  noteEntryEntity,
  noteEntryExecutor,
  noteMentionEntity,
} from "../../notes-history";
import { createSessionsFeature, userSessionEntity } from "../../sessions";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsFeature, runForgetCleanup } from "../../user-data-rights";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults";
import { notesHistoryUserDataFeature } from "..";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
function pastInstant(): Instant {
  return getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);
}

const CONTACT_TABLE = "notes_mention_forget_test_contacts";
const contactEntity = createEntity({
  table: CONTACT_TABLE,
  fields: { name: createTextField({ required: true, maxLength: 64 }) },
});
const contactFixtureFeature = defineFeature("notes-mention-forget-test-contact-fixture", (r) => {
  r.entity("contact", contactEntity);
});

const author = createTestUser({ id: 1, roles: ["TenantMember"] });
const CONTACT_1 = "40000000-0000-4000-8000-000000000001";
const SUBJECT_S = "40000000-0000-4000-8000-0000000000ff";

let stack: TestStack;
let overrideExecutor: ReturnType<typeof createEventStoreExecutor>;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createFilesFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
      createNotesHistoryFeature(),
      notesHistoryUserDataFeature,
      contactFixtureFeature,
    ],
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, noteEntryEntity, "note-entry");
  await unsafeCreateEntityTable(stack.db, noteMentionEntity, "note-mention");
  await unsafeCreateEntityTable(stack.db, contactEntity);
  await unsafePushTables(stack.db, { fileRefsTable });
  await createEventsTable(stack.db);
  // tenant-membership table (from the tenant feature) manually created — same
  // minimal setup as run-forget-cleanup.integration.test.ts, no tenant feature
  // mounted here.
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
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${CONTACT_TABLE} (id, tenant_id, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [CONTACT_1, author.tenantId, "Contact 1"],
  );

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
  await resetTestTables(stack.db, [
    userTable,
    "read_tenant_memberships",
    tenantRetentionOverrideTable,
  ]);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function seedForgottenSubject(): Promise<void> {
  await seedRow(stack.db, userTable, {
    id: SUBJECT_S,
    tenantId: author.tenantId,
    email: "subject-s@example.com",
    passwordHash: "hashed",
    displayName: "Subject S",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.DeletionRequested,
    gracePeriodEnd: pastInstant(),
  });
  await asRawClient(stack.db).unsafe(
    `INSERT INTO read_tenant_memberships (tenant_id, user_id, roles)
     VALUES ($1, $2, '["Member"]') ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [author.tenantId, SUBJECT_S],
  );
}

async function seedContactRetentionOverride(strategy: "anonymize" | "delete"): Promise<void> {
  const by = { ...TestUsers.systemAdmin, tenantId: author.tenantId };
  const result = await overrideExecutor.create(
    {
      entityName: "contact",
      config: JSON.stringify({ keepFor: "1y", strategy }),
      reason: "test",
      tenantId: author.tenantId,
    },
    by,
    createTenantDb(stack.db, author.tenantId, "system"),
  );
  if (!result.isSuccess)
    throw new Error(`seedContactRetentionOverride failed: ${JSON.stringify(result)}`);
}

describe("notes-history mention-forget cascade", () => {
  test("shreds only the note mentioning the forgotten subject, leaves the unmentioned note readable", async () => {
    await seedForgottenSubject();
    const tenantDb = createTenantDb(stack.db, author.tenantId, "system");

    const mentioning = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_1, body: "about S", mentions: [SUBJECT_S] },
      author,
    );
    const unrelated = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_1, body: "unrelated note" },
      author,
    );

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: getTemporal().Now.instant(),
    });
    expect(result.processedUserIds).toContain(SUBJECT_S);
    expect(result.errors).toEqual([]);

    const shredded = await noteEntryExecutor.detail({ id: mentioning.id }, author, tenantDb);
    expect(shredded?.["body"]).toBe(PII_ERASED_SENTINEL);

    const untouched = await noteEntryExecutor.detail({ id: unrelated.id }, author, tenantDb);
    expect(untouched?.["body"]).toBe("unrelated note");
  });

  test("host entity retention override (anonymize) blocks the shred", async () => {
    await seedForgottenSubject();
    await seedContactRetentionOverride("anonymize");
    const tenantDb = createTenantDb(stack.db, author.tenantId, "system");

    const mentioning = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      {
        entityType: "contact",
        entityId: CONTACT_1,
        body: "kept under retention",
        mentions: [SUBJECT_S],
      },
      author,
    );

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: getTemporal().Now.instant(),
    });
    expect(result.processedUserIds).toContain(SUBJECT_S);

    const stillReadable = await noteEntryExecutor.detail({ id: mentioning.id }, author, tenantDb);
    expect(stillReadable?.["body"]).toBe("kept under retention");
  });
});
