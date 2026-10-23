// notes-history mention-forget cascade:
//
//   - a note carrying a structured @-mention on a forgotten user S has its
//     `body` (Row-Subject, personal: { of: "id" }) crypto-shredded when S's
//     Art. 17 forget runs (runForgetCleanup → noteEntryDeleteHook →
//     note-mention lookup → kms.eraseKey on the note's own record subject)
//   - a sibling note on the SAME host with NO mention on S stays fully
//     readable — proves the cascade doesn't collaterally shred every note
//   - the host entity's retention strategy (anonymize/blockDelete) does NOT
//     block the shred: the note text is free PII, the strategy protects the row

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";

import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  asRawClient,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
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
import {
  ComplianceProfileHandlers,
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.ts";
import { tenantRetentionOverrideTable } from "../../data-retention/schema/tenant-retention-override.ts";
import { createFilesFeature } from "../../files/index.ts";
import {
  createNotesHistoryFeature,
  NotesHistoryHandlers,
  noteEntryEntity,
  noteEntryExecutor,
  noteMentionEntity,
} from "../../notes-history/index.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { decryptStoredPii } from "../../shared/index.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature, runForgetCleanup } from "../../user-data-rights/index.ts";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.ts";
import { noteMentionExportHook } from "../hooks.ts";
import { createNotesHistoryUserDataFeature } from "../index.ts";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
function pastInstant(): Instant {
  return getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);
}

const CONTACT_TABLE = "notes_mention_forget_test_contacts";
const contactEntity = createEntity({
  table: CONTACT_TABLE,
  fields: {
    name: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 64,
    }),
  },
});
const contactFixtureFeature = defineFeature("notes-mention-forget-test-contact-fixture", (r) => {
  r.entity({ name: "contact", ...contactEntity });
});

// No own `retention` default: only a tenant compliance profile's preset
// (RETENTION_PRESETS["dsgvo-hgb"].invoice = blockDelete) can protect it.
const INVOICE_TABLE = "notes_mention_forget_test_invoices";
const invoiceEntity = createEntity({
  table: INVOICE_TABLE,
  fields: {
    amount: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 64,
    }),
  },
});
const invoiceFixtureFeature = defineFeature("notes-mention-forget-test-invoice-fixture", (r) => {
  r.entity({ name: "invoice", ...invoiceEntity });
});

const author = createTestUser({ id: 1, roles: ["TenantMember"] });
const CONTACT_1 = "40000000-0000-4000-8000-000000000001";
const INVOICE_1 = "40000000-0000-4000-8000-000000000002";
const SUBJECT_S = "40000000-0000-4000-8000-0000000000ff";

let stack: TestStack;
let overrideExecutor: ReturnType<typeof createEventStoreExecutor>;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createFilesFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
      createNotesHistoryFeature(),
      createNotesHistoryUserDataFeature(),
      contactFixtureFeature,
      invoiceFixtureFeature,
    ],
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, noteEntryEntity, "note-entry");
  await unsafeCreateEntityTable(stack.db, noteMentionEntity, "note-mention");
  await unsafeCreateEntityTable(stack.db, contactEntity);
  await unsafeCreateEntityTable(stack.db, invoiceEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { fileRefsTable });
  // No tenant feature is mounted here, so the membership table the forget
  // cleanup iterates is created from its entity.
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${CONTACT_TABLE} (id, tenant_id, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [CONTACT_1, author.tenantId, "Contact 1"],
  );
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${INVOICE_TABLE} (id, tenant_id, amount) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [INVOICE_1, author.tenantId, "100.00"],
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
    tenantComplianceProfileTable,
    eventsTable,
  ]);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function seedForgottenSubject(): Promise<void> {
  await seedRowViaEventStore(stack.db, userTable, {
    id: SUBJECT_S,
    email: "subject-s@example.com",
    passwordHash: "hashed",
    displayName: "Subject S",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.DeletionRequested,
    gracePeriodEnd: pastInstant(),
  });
  await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
    tenantId: author.tenantId,
    userId: SUBJECT_S,
    roles: '["Member"]',
  });
}

async function seedContactRetentionOverride(
  strategy: "anonymize" | "blockDelete" | "hardDelete",
): Promise<void> {
  const by = { ...TestUsers.systemAdmin, tenantId: author.tenantId };
  const result = await overrideExecutor.create(
    {
      entityName: "contact",
      config: JSON.stringify({ keepFor: "1y", strategy }),
      reason: "test",
      tenantId: author.tenantId,
    },
    by,
    createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "system" }),
  );
  if (!result.isSuccess)
    throw new Error(`seedContactRetentionOverride failed: ${JSON.stringify(result)}`);
}

describe("notes-history mention-forget cascade", () => {
  test("shreds only the note mentioning the forgotten subject, leaves the unmentioned note readable", async () => {
    await seedForgottenSubject();
    const tenantDb = createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "system" });

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

  test("host entity retention override (anonymize) still shreds the body", async () => {
    await seedForgottenSubject();
    await seedContactRetentionOverride("anonymize");
    const tenantDb = createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "system" });

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

    const shredded = await noteEntryExecutor.detail({ id: mentioning.id }, author, tenantDb);
    expect(shredded?.["body"]).toBe(PII_ERASED_SENTINEL);
  });

  test("host entity retention override (blockDelete) still shreds the body", async () => {
    await seedForgottenSubject();
    await seedContactRetentionOverride("blockDelete");
    const tenantDb = createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "system" });

    const mentioning = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      {
        entityType: "contact",
        entityId: CONTACT_1,
        body: "kept under legal hold",
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

    const shredded = await noteEntryExecutor.detail({ id: mentioning.id }, author, tenantDb);
    expect(shredded?.["body"]).toBe(PII_ERASED_SENTINEL);
  });

  test("host entity retention override (hardDelete) does not block the shred", async () => {
    await seedForgottenSubject();
    await seedContactRetentionOverride("hardDelete");
    const tenantDb = createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "system" });

    const mentioning = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_1, body: "to be shredded", mentions: [SUBJECT_S] },
      author,
    );

    await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: getTemporal().Now.instant(),
    });

    const shredded = await noteEntryExecutor.detail({ id: mentioning.id }, author, tenantDb);
    expect(shredded?.["body"]).toBe(PII_ERASED_SENTINEL);
  });

  test("duplicate ids in mentions produce exactly one mention row and the note is shredded once", async () => {
    await seedForgottenSubject();
    const tenantDb = createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "system" });

    const mentioning = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      {
        entityType: "contact",
        entityId: CONTACT_1,
        body: "mentions S twice",
        mentions: [SUBJECT_S, SUBJECT_S],
      },
      author,
    );
    const [mentionCount] = await asRawClient(stack.db).unsafe<{ count: number }>(
      "SELECT count(*)::int AS count FROM read_note_mentions WHERE note_id = $1",
      [mentioning.id],
    );
    expect(mentionCount?.count).toBe(1);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: getTemporal().Now.instant(),
    });
    expect(result.errors).toEqual([]);

    const shredded = await noteEntryExecutor.detail({ id: mentioning.id }, author, tenantDb);
    expect(shredded?.["body"]).toBe(PII_ERASED_SENTINEL);
  });

  test("without a mounted KMS the forget run leaves the mentioned note readable", async () => {
    resetPiiSubjectKmsForTests();
    await seedForgottenSubject();
    const tenantDb = createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "system" });

    const mentioning = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_1, body: "plaintext body", mentions: [SUBJECT_S] },
      author,
    );

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: getTemporal().Now.instant(),
    });
    expect(result.errors).toEqual([]);

    const readable = await noteEntryExecutor.detail({ id: mentioning.id }, author, tenantDb);
    expect(readable?.["body"]).toBe("plaintext body");
  });

  test("a failing mention create rolls the note back with it", async () => {
    const raw = asRawClient(stack.db);
    await raw.unsafe(`
      CREATE OR REPLACE FUNCTION notes_mention_forget_test_reject() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'mention insert rejected'; END $$ LANGUAGE plpgsql
    `);
    await raw.unsafe(`
      CREATE TRIGGER notes_mention_forget_test_reject BEFORE INSERT ON read_note_mentions
      FOR EACH ROW EXECUTE FUNCTION notes_mention_forget_test_reject()
    `);
    try {
      const [before] = await raw.unsafe<{ count: number }>(
        "SELECT count(*)::int AS count FROM read_note_entries WHERE body = $1",
        ["rolled back"],
      );
      const res = await stack.http.write(
        NotesHistoryHandlers.addNote,
        {
          entityType: "contact",
          entityId: CONTACT_1,
          body: "rolled back",
          mentions: [SUBJECT_S],
        },
        author,
      );
      expect(res.status).toBeGreaterThanOrEqual(400);

      const [after] = await raw.unsafe<{ count: number }>(
        "SELECT count(*)::int AS count FROM read_note_entries WHERE body = $1",
        ["rolled back"],
      );
      expect(after?.count).toBe(before?.count);
    } finally {
      await raw.unsafe("DROP TRIGGER notes_mention_forget_test_reject ON read_note_mentions");
      await raw.unsafe("DROP FUNCTION notes_mention_forget_test_reject()");
    }
  });

  test("host entity protected by the tenant's compliance-profile preset still shreds the body", async () => {
    await seedForgottenSubject();
    await stack.http.writeOk(
      ComplianceProfileHandlers.setProfile,
      { profileKey: "de-hr-dsgvo-hgb" },
      createTestUser({ id: 2, tenantId: author.tenantId, roles: ["TenantAdmin"] }),
    );
    const tenantDb = createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "system" });

    const mentioning = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      {
        entityType: "invoice",
        entityId: INVOICE_1,
        body: "kept under preset retention",
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
    expect(result.errors).toEqual([]);

    const stillReadable = await noteEntryExecutor.detail({ id: mentioning.id }, author, tenantDb);
    expect(stillReadable?.["body"]).toBe(PII_ERASED_SENTINEL);
  });

  test("same invoice host without a compliance profile: the mentioned note is shredded", async () => {
    await seedForgottenSubject();
    const tenantDb = createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "system" });

    const mentioning = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      {
        entityType: "invoice",
        entityId: INVOICE_1,
        body: "no preset, shredded",
        mentions: [SUBJECT_S],
      },
      author,
    );

    await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: getTemporal().Now.instant(),
    });

    const shredded = await noteEntryExecutor.detail({ id: mentioning.id }, author, tenantDb);
    expect(shredded?.["body"]).toBe(PII_ERASED_SENTINEL);
  });
});

describe("notes-history mention scoping and export", () => {
  beforeEach(async () => {
    await resetTestTables(stack.db, ["read_note_entries", "read_note_mentions", eventsTable]);
  });

  test("add-note rejects a mention of a user who is not a member of the tenant and stores nothing", async () => {
    const error = await stack.http.writeErr(
      NotesHistoryHandlers.addNote,
      {
        entityType: "contact",
        entityId: CONTACT_1,
        body: "about a stranger",
        mentions: [SUBJECT_S],
      },
      author,
    );

    expect(error.code).toBe("validation_error");
    const raw = asRawClient(stack.db);
    const notes = await raw.unsafe("SELECT count(*)::int AS count FROM read_note_entries");
    const mentions = await raw.unsafe("SELECT count(*)::int AS count FROM read_note_mentions");
    expect((notes as ReadonlyArray<{ count: number }>)[0]?.count).toBe(0);
    expect((mentions as ReadonlyArray<{ count: number }>)[0]?.count).toBe(0);
  });

  test("the mentioned user's export lists the notes that mention them, and nothing else", async () => {
    await seedForgottenSubject();
    const mentioning = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_1, body: "about S", mentions: [SUBJECT_S] },
      author,
    );
    await stack.http.writeOk(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_1, body: "unrelated note" },
      author,
    );

    const snippet = await noteMentionExportHook({
      db: createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "tenant" }),
      registry: stack.registry,
      tenantId: author.tenantId,
      userId: SUBJECT_S,
    });

    expect(snippet?.entity).toBe("note-mention");
    expect(snippet?.rows).toEqual([
      expect.objectContaining({
        noteId: mentioning.id,
        entityType: "contact",
        entityId: CONTACT_1,
      }),
    ]);
    // The hook hands out the stored ciphertext; the export pipeline decrypts
    // self-describing kumiko-pii values centrally.
    const exportedBody = String(snippet?.rows[0]?.["body"]);
    expect(isPiiCiphertext(exportedBody)).toBe(true);
    expect(await decryptStoredPii(exportedBody, "body", "notes-history-test")).toBe("about S");
  });

  test("the export is null for a user no note mentions", async () => {
    const snippet = await noteMentionExportHook({
      db: createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "tenant" }),
      registry: stack.registry,
      tenantId: author.tenantId,
      userId: SUBJECT_S,
    });
    expect(snippet).toBeNull();
  });
});
