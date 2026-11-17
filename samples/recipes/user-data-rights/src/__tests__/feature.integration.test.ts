// User-data-rights recipe — integration test.
//
// Pins that the two hooks from feature.ts do exactly what the recipe
// README promises:
//   1. The user's notes land in the bundle snippet via the export hook.
//   2. The forget-cleanup cron removes the notes via the delete hook (strategy
//      "delete", default).
//   3. Strategy "anonymize" (HR override) sets authorId=null instead of
//      deleting — the row stays intact for multi-user refs.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import {
  tenantMembershipEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  createUserFeature,
  USER_STATUS,
  userTable,
} from "@cosmicdrift/kumiko-bundled-features/user";
import {
  createUserDataRightsFeature,
  runForgetCleanup,
  runUserExport,
} from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { deleteRowViaEventStore, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { muteEntity, mutesTable, notesFeature, type NoteRow, notesTable } from "../feature";

let stack: TestStack;

// Each test gets its own tenant and user, so rows from other tests never show up.
let testNumber = 0;
let TENANT_A = "";
let TENANT_B = "";
let ALICE_ID = "";
let BOB_ID = "";
let CAROL_ID = "";
let ALICE_EMAIL = "";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const NOW = (): Instant => getTemporal().Now.instant();
const PAST = (): Instant => getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
      notesFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  testNumber += 1;
  const suffix = String(testNumber).padStart(12, "0");
  TENANT_A = `00000000-0000-4000-8000-${suffix}`;
  TENANT_B = `00000000-0000-4000-9000-${suffix}`;
  ALICE_ID = `11111111-1111-4111-8111-${suffix}`;
  BOB_ID = `22222222-2222-4222-8222-${suffix}`;
  CAROL_ID = `33333333-3333-4333-8333-${suffix}`;
  ALICE_EMAIL = `alice-${testNumber}@recipe.test`;
});

function noteId(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(testNumber * 10 + index).padStart(12, "0")}`;
}

async function seedMute(
  id: string,
  tenantId: string,
  userId: string,
  mutedUserId: string,
): Promise<void> {
  await seedRowViaEventStore(stack.db, mutesTable, { id, tenantId, userId, mutedUserId });
}

async function seedAlice(opts: { gracePeriodEnd?: Instant; status?: string } = {}): Promise<void> {
  await seedRowViaEventStore(stack.db, userTable, {
    id: ALICE_ID,
    email: ALICE_EMAIL,
    passwordHash: "h",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: opts.status ?? USER_STATUS.Active,
    gracePeriodEnd: opts.gracePeriodEnd ?? null,
  });
  await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
    tenantId: TENANT_A,
    userId: ALICE_ID,
    roles: '["Member"]',
  });
}

async function seedNote(id: string, title: string): Promise<void> {
  await insertOne(stack.db, notesTable, {
    id,
    tenantId: TENANT_A,
    authorId: ALICE_ID,
    title,
    body: `body for ${title}`,
  });
}

describe("user-data-rights recipe :: EXT_USER_DATA-Hooks integrieren Notes-Domain", () => {
  test("Export-Bundle enthaelt Note-Snippet via Hook", async () => {
    await seedAlice();
    await seedNote(noteId(1), "first");
    await seedNote(noteId(2), "second");

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: ALICE_ID,
      now: NOW(),
    });

    const tenantA = bundle.tenants.find((t) => t.tenantId === TENANT_A);
    const noteSnippet = tenantA?.entities.find((e) => e.entity === "note");
    expect(noteSnippet?.rows).toHaveLength(2);
    expect((noteSnippet?.rows ?? []).map((r) => String(r["title"])).sort()).toEqual([
      "first",
      "second",
    ]);
  });

  test("Forget-Cron strategy=delete entfernt Notes (Default-Pfad)", async () => {
    await seedAlice({ status: USER_STATUS.DeletionRequested, gracePeriodEnd: PAST() });
    await seedNote(noteId(1), "to-delete");

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });
    expect(result.processedUserIds).toContain(ALICE_ID);

    const remaining = await selectMany<NoteRow>(stack.db, notesTable, { tenantId: TENANT_A });
    expect(remaining.length).toBe(0);
  });

  test("Strategy=anonymize: authorId=null, row remains (HR-Compliance path)", async () => {
    await seedAlice();
    await seedNote(noteId(1), "stays-anonymous");

    const usage = stack.registry
      .getExtensionUsages(EXT_USER_DATA)
      .find((u) => u.entityName === "note");
    const hooks = usage?.options as
      | {
          delete?: (
            ctx: { db: typeof stack.db; tenantId: string; userId: string },
            strategy: "delete" | "anonymize",
          ) => Promise<void>;
        }
      | undefined;
    await hooks?.delete?.({ db: stack.db, tenantId: TENANT_A, userId: ALICE_ID }, "anonymize");

    const after = await selectMany<NoteRow>(stack.db, notesTable, { tenantId: TENANT_A });
    expect(after).toHaveLength(1);
    expect(after[0]?.authorId).toBeNull();
    expect(after[0]?.title).toBe("stays-anonymous");
  });
});

describe("forgetOwnRowsDeleteHook :: event-sourced mutes", () => {
  test("the forget cron erases every mute naming the user once, trashed ones included, and keeps the rest", async () => {
    await seedAlice({ status: USER_STATUS.DeletionRequested, gracePeriodEnd: PAST() });
    const [setByAlice, aliceMuted, selfMute, trashed, unrelated, otherTenant] = [
      noteId(5),
      noteId(6),
      noteId(7),
      noteId(8),
      noteId(9),
      noteId(4),
    ];
    await seedMute(setByAlice, TENANT_A, ALICE_ID, BOB_ID);
    await seedMute(aliceMuted, TENANT_A, BOB_ID, ALICE_ID);
    await seedMute(selfMute, TENANT_A, ALICE_ID, ALICE_ID);
    await seedMute(trashed, TENANT_A, ALICE_ID, CAROL_ID);
    await seedMute(unrelated, TENANT_A, BOB_ID, CAROL_ID);
    await seedMute(otherTenant, TENANT_B, ALICE_ID, BOB_ID);
    await deleteRowViaEventStore(
      stack.db,
      { table: mutesTable, entity: muteEntity, entityName: "mute" },
      { id: trashed },
      { tenantId: TENANT_A },
    );

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });
    expect(result.processedUserIds).toContain(ALICE_ID);

    const remainingA = await selectMany(stack.db, mutesTable, { tenantId: TENANT_A });
    expect(remainingA.map((r) => r.id)).toEqual([unrelated]);
    const remainingB = await selectMany(stack.db, mutesTable, { tenantId: TENANT_B });
    expect(remainingB.map((r) => r.id)).toEqual([otherTenant]);
  });
});
