// fw#1611: purgeSearchDocumentsForSubject must run BEFORE the EXT_USER_DATA
// delete-hooks, not after. purge discovers candidate rows via a live SELECT
// on each entity's read-table; a hook with UserDataDeleteStrategy "delete"
// hard-deletes matching rows inside the same sub-tx. If purge ran after the
// hooks (the pre-fix ordering), a hard-deleted row's search doc — which
// holds plaintext for a searchable subject-owned field — would be invisible
// to that SELECT and survive the erasure permanently.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type UserDataDeleteHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createSessionsFeature, userSessionEntity } from "../../sessions";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { runForgetCleanup } from "../run-forget-cleanup";

const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";
const TENANT_A = "00000000-0000-4000-8000-0000000000f1";
const ALICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000f1";
const NOTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-0000000000f1";

// A note "owned by" whoever wrote it (authorId), with a searchable body —
// userOwned + searchable makes `body` a subject field purge-subject.ts
// looks for.
const noteEntity = createEntity({
  table: "read_forget_purge_notes",
  fields: {
    authorId: createTextField({ required: true }),
    body: createTextField({
      required: true,
      searchable: true,
      userOwned: { ownerField: "authorId" },
    }),
  },
});
const noteTable = buildEntityTable("note", noteEntity);

const hardDeleteNoteHook: UserDataDeleteHook = async (ctx, strategy) => {
  if (strategy !== "delete") return;
  await asRawClient(ctx.db).unsafe(
    `DELETE FROM read_forget_purge_notes WHERE author_id = $1 AND tenant_id = $2`,
    [ctx.userId, ctx.tenantId],
  );
};

const noteFeature = defineFeature("forget-purge-notes", (r) => {
  r.entity("note", noteEntity);
  r.useExtension(EXT_USER_DATA, "note", {
    export: async () => null,
    delete: hardDeleteNoteHook,
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createUserDataRightsFeature(),
      noteFeature,
    ],
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, noteEntity);
  await asRawClient(stack.db).unsafe(`
    CREATE TABLE IF NOT EXISTS read_tenant_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      roles JSONB NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 0,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

test("fw#1611: search purge finds + removes a row's doc even when a delete-hook hard-deletes that row in the same run", async () => {
  const now = getTemporal().Now.instant();

  await seedRow(stack.db, userTable, {
    id: ALICE_ID,
    tenantId: TENANT_SYSTEM,
    email: "alice-purge-order@acme.test",
    passwordHash: "hashed",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.DeletionRequested,
    gracePeriodEnd: now.subtract({ hours: 1 }).toString(),
  });

  await asRawClient(stack.db).unsafe(
    `INSERT INTO read_tenant_memberships (tenant_id, user_id, roles) VALUES ($1, $2, '["Member"]')`,
    [TENANT_A, ALICE_ID],
  );

  await seedRow(stack.db, noteTable, {
    id: NOTE_ID,
    tenantId: TENANT_A,
    authorId: ALICE_ID,
    body: "UniquePurgeOrderingBody1611",
  });
  await stack.search.index(TENANT_A, {
    entityType: "note",
    entityId: NOTE_ID,
    weight: 1,
    fields: { body: "UniquePurgeOrderingBody1611" },
  });

  const preHits = await stack.search.search(TENANT_A, "UniquePurgeOrderingBody1611", {
    filterType: "note",
  });
  expect(preHits.some((h) => String(h.entityId) === NOTE_ID)).toBe(true);

  const result = await runForgetCleanup({
    db: stack.db,
    registry: stack.registry,
    now,
    searchAdapter: stack.search,
  });
  expect(result.errors).toHaveLength(0);
  expect(result.processedUserIds).toContain(ALICE_ID);

  // The hook already hard-deleted the row (proves the hook ran)...
  const rows = await asRawClient(stack.db).unsafe(
    `SELECT id FROM read_forget_purge_notes WHERE id = $1`,
    [NOTE_ID],
  );
  expect(rows).toHaveLength(0);

  // ...and the search doc is gone too — only possible if purge ran BEFORE
  // the hook deleted the row (or found it some other way). Pre-fix, purge
  // ran after the hooks and its SELECT would find nothing, leaving this
  // plaintext doc stranded in the index forever.
  const postHits = await stack.search.search(TENANT_A, "UniquePurgeOrderingBody1611", {
    filterType: "note",
  });
  expect(postHits.some((h) => String(h.entityId) === NOTE_ID)).toBe(false);
});
