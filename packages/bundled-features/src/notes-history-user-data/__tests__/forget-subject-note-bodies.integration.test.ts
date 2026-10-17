// Manual forget-subject (crypto-shredding) must reach note bodies keyed per note:
// notes hanging on the subject as host entity and notes mentioning it. Forgetting
// only the AUTHOR leaves bodies readable. Without these, forget-subject(contact)
// would leave every note about that contact in plaintext.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";

import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  asRawClient,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  seedRow,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.js";
import { createCryptoShreddingFeature } from "../../crypto-shredding/index.js";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.js";
import { tenantRetentionOverrideTable } from "../../data-retention/schema/tenant-retention-override.js";
import { createFilesFeature } from "../../files/index.js";
import {
  createNotesHistoryFeature,
  NotesHistoryHandlers,
  noteEntryEntity,
  noteEntryExecutor,
  noteMentionEntity,
} from "../../notes-history/index.js";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.js";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.js";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.js";
import { createUserDataRightsFeature } from "../../user-data-rights/index.js";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.js";
import { noteMentionExportHook } from "../hooks.js";
import { notesHistoryUserDataFeature } from "../index.js";

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
const CONTACT_X = "40000000-0000-4000-8000-0000000000aa";
const INVOICE_1 = "40000000-0000-4000-8000-000000000002";
const SUBJECT_S = "40000000-0000-4000-8000-0000000000ff";
const FORGET = "crypto-shredding:write:forget-subject";
const REASON = "authority request for contact erasure";
const dpo = createTestUser({ id: 2, roles: ["DataProtectionOfficer"] });

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
      createCryptoShreddingFeature(),
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
    `INSERT INTO ${CONTACT_TABLE} (id, tenant_id, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [CONTACT_X, author.tenantId, "Contact X"],
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
  ]);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

beforeEach(async () => {
  await resetTestTables(stack.db, ["read_note_entries", "read_note_mentions"]);
});

async function seedUserS(): Promise<void> {
  await seedRow(stack.db, userTable, {
    id: SUBJECT_S,
    tenantId: author.tenantId,
    email: "subject-s@example.com",
    passwordHash: "hashed",
    displayName: "Subject S",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
  });
  await seedRow(stack.db, tenantMembershipsTable, {
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

async function addNote(
  entityId: string,
  body: string,
  mentions?: readonly string[],
): Promise<string> {
  const note = await stack.http.writeOk<{ id: string }>(
    NotesHistoryHandlers.addNote,
    { entityType: "contact", entityId, body, ...(mentions && { mentions }) },
    author,
  );
  return note.id;
}

async function bodyOf(noteId: string): Promise<unknown> {
  const tenantDb = createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "system" });
  return (await noteEntryExecutor.detail({ id: noteId }, author, tenantDb))?.["body"];
}

describe("forget-subject reaches note bodies", () => {
  test("user subject: notes on the subject and notes mentioning it are erased, others stay readable", async () => {
    await seedUserS();
    const attached = await addNote(CONTACT_X, "note on X");
    const mentioning = await addNote(CONTACT_1, "about S", [SUBJECT_S]);
    const unrelated = await addNote(CONTACT_1, "unrelated");

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: CONTACT_X }, reason: REASON },
      dpo,
    );
    expect(await bodyOf(attached)).toBe(PII_ERASED_SENTINEL);
    expect(await bodyOf(mentioning)).toBe("about S");

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: SUBJECT_S }, reason: REASON },
      dpo,
    );
    expect(await bodyOf(mentioning)).toBe(PII_ERASED_SENTINEL);
    expect(await bodyOf(unrelated)).toBe("unrelated");
  });

  test("forgetting the AUTHOR leaves the note bodies readable", async () => {
    const note = await addNote(CONTACT_X, "written by the author");

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: author.id }, reason: REASON },
      dpo,
    );

    expect(await bodyOf(note)).toBe("written by the author");
  });

  for (const strategy of ["anonymize", "blockDelete"] as const) {
    test(`host entity retention ${strategy} still shreds the body`, async () => {
      await seedContactRetentionOverride(strategy);
      const attached = await addNote(CONTACT_X, "free-text PII under retention");

      await stack.http.writeOk(
        FORGET,
        { subject: { kind: "user", userId: CONTACT_X }, reason: REASON },
        dpo,
      );

      expect(await bodyOf(attached)).toBe(PII_ERASED_SENTINEL);
    });
  }

  test("record subject: only notes on that entity type and id are erased", async () => {
    const onContact = await addNote(CONTACT_X, "note on the contact row");
    const onOther = await addNote(CONTACT_1, "note on another contact");

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "record", entity: "contact", id: CONTACT_X }, reason: REASON },
      dpo,
    );

    expect(await bodyOf(onContact)).toBe(PII_ERASED_SENTINEL);
    expect(await bodyOf(onOther)).toBe("note on another contact");
  });

  test("the user's export lists the notes on the user as host entity", async () => {
    const attached = await addNote(CONTACT_X, "listed in the export");
    const snippet = await noteMentionExportHook({
      db: createTenantDb({ db: stack.db, tenantId: author.tenantId, mode: "tenant" }),
      registry: stack.registry,
      tenantId: author.tenantId,
      userId: CONTACT_X,
    });
    expect(snippet?.rows.map((row) => row["noteId"])).toEqual([attached]);
  });
});
