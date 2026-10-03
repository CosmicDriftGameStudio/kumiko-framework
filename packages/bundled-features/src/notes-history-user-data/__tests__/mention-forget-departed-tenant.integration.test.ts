// A user mentioned in tenant T who LEFT T before requesting forget must still
// have the mention-bearing notes in T shredded: the forget run reaches tenants
// from membership history, not only live memberships.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  seedRow,
} from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { configValueEntity } from "../../config/table.js";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.js";
import { createFilesFeature } from "../../files/index.js";
import {
  createNotesHistoryFeature,
  NotesHistoryHandlers,
  noteEntryEntity,
  noteEntryExecutor,
  noteMentionEntity,
} from "../../notes-history/index.js";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.js";
import { TenantHandlers } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantInvitationEntity } from "../../tenant/invitation-table.js";
import { tenantMembershipEntity } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenantMembership } from "../../tenant/seeding.js";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.js";
import { createUserDataRightsFeature, runForgetCleanup } from "../../user-data-rights/index.js";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.js";
import { notesHistoryUserDataFeature } from "../index.js";

const CONTACT_TABLE = "notes_departed_tenant_test_contacts";
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
const contactFixtureFeature = defineFeature("notes-departed-tenant-test-contact-fixture", (r) => {
  r.entity("contact", contactEntity);
});

const hookTenantCalls: TenantId[] = [];
const hookProbeFeature = defineFeature("notes-departed-tenant-test-hook-probe", (r) => {
  r.useExtension(EXT_USER_DATA, "contact", {
    export: async () => null,
    delete: async (ctx) => {
      hookTenantCalls.push(ctx.tenantId);
    },
  });
});

const TENANT_T = testTenantId(11);
const TENANT_U = testTenantId(12);
const TENANT_V = testTenantId(13);
const SUBJECT_X = "50000000-0000-4000-8000-0000000000ff";
const OTHER_USER = "50000000-0000-4000-8000-0000000000ee";
const CONTACT_T = "50000000-0000-4000-8000-000000000001";
const CONTACT_V = "50000000-0000-4000-8000-000000000002";

const noteAuthorInT = createTestUser({ id: 1, tenantId: TENANT_T, roles: ["TenantMember"] });
const noteAuthorInV = createTestUser({ id: 2, tenantId: TENANT_V, roles: ["TenantMember"] });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
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
      hookProbeFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, configValueEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity, "tenant-membership");
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, noteEntryEntity, "note-entry");
  await unsafeCreateEntityTable(stack.db, noteMentionEntity, "note-mention");
  await unsafeCreateEntityTable(stack.db, contactEntity);
  for (const [id, tenantId] of [
    [CONTACT_T, TENANT_T],
    [CONTACT_V, TENANT_V],
  ] as const) {
    await asRawClient(stack.db).unsafe(
      `INSERT INTO ${CONTACT_TABLE} (id, tenant_id, name) VALUES ($1, $2, 'Contact')
       ON CONFLICT (id) DO NOTHING`,
      [id, tenantId],
    );
  }
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack);
  await resetTestTables(stack.db, [userTable]);
  hookTenantCalls.length = 0;
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function seedForgottenSubject(): Promise<void> {
  await seedRow(stack.db, userTable, {
    id: SUBJECT_X,
    tenantId: TENANT_T,
    email: "subject-x@example.com",
    passwordHash: "hashed",
    displayName: "Subject X",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.DeletionRequested,
    gracePeriodEnd: getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000),
  });
}

const forgetNow = () =>
  runForgetCleanup({
    db: stack.db,
    registry: stack.registry,
    now: getTemporal().Now.instant(),
  });

describe("forget reaches tenants the user already left", () => {
  test("a note mentioning X in departed tenant T is shredded; unrelated tenant V is untouched", async () => {
    await seedForgottenSubject();
    await seedTenantMembership(stack.db, {
      userId: SUBJECT_X,
      tenantId: TENANT_T,
      roles: ["User"],
    });
    await seedTenantMembership(stack.db, {
      userId: SUBJECT_X,
      tenantId: TENANT_U,
      roles: ["User"],
    });
    await seedTenantMembership(stack.db, {
      userId: OTHER_USER,
      tenantId: TENANT_V,
      roles: ["User"],
    });

    const mentionInT = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_T, body: "about X", mentions: [SUBJECT_X] },
      noteAuthorInT,
    );
    const noteInV = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_V, body: "unrelated to X" },
      noteAuthorInV,
    );

    await stack.http.writeOk(
      TenantHandlers.removeMember,
      { userId: SUBJECT_X, tenantId: TENANT_T },
      TestUsers.systemAdmin,
    );
    const liveInT = await asRawClient(stack.db).unsafe(
      "SELECT id FROM read_tenant_memberships WHERE tenant_id = $1 AND user_id = $2",
      [TENANT_T, SUBJECT_X],
    );
    expect(liveInT.length).toBe(0);

    const result = await forgetNow();
    expect(result.errors).toEqual([]);
    expect(result.processedUserIds).toContain(SUBJECT_X);

    const shredded = await noteEntryExecutor.detail(
      { id: mentionInT.id },
      noteAuthorInT,
      createTenantDb(stack.db, TENANT_T, "system"),
    );
    expect(shredded?.["body"]).toBe(PII_ERASED_SENTINEL);

    const untouched = await noteEntryExecutor.detail(
      { id: noteInV.id },
      noteAuthorInV,
      createTenantDb(stack.db, TENANT_V, "system"),
    );
    expect(untouched?.["body"]).toBe("unrelated to X");

    // U is both a live membership and in history: still exactly one pass.
    expect([...hookTenantCalls].sort()).toEqual([TENANT_T, TENANT_U].sort());
    expect(result.hookCallsAttempted).toBe(
      stack.registry.getExtensionUsages(EXT_USER_DATA).length * 2,
    );
  });
});
