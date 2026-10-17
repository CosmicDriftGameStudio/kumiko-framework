// User-Data-Rights Recipe — Integration-Test.
//
// Pinst dass die zwei Hooks aus feature.ts genau das tun was die Recipe-
// README verspricht:
//   1. Notes des Users landen via export-Hook im Bundle-Snippet.
//   2. Forget-Cleanup-Cron entfernt die Notes via delete-Hook (strategy
//      "delete", default).
//   3. Strategy "anonymize" (HR-Override) setzt authorId=null statt zu
//      löschen — Row bleibt für Multi-User-Refs intakt.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import {
  tenantMembershipEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  createUserFeature,
  USER_STATUS,
  userEntity,
  userTable,
} from "@cosmicdrift/kumiko-bundled-features/user";
import {
  createUserDataRightsFeature,
  runForgetCleanup,
  runUserExport,
} from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { noteEntity, notesFeature, notesTable } from "../feature";

let stack: TestStack;

const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";

// Each test gets its own tenant and user, so rows from other tests never show up.
let testNumber = 0;
let TENANT_A = "";
let ALICE_ID = "";
let ALICE_EMAIL = "";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const NOW = (): Instant => getTemporal().Now.instant();
const PAST = (): Instant => getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
      notesFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, noteEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  testNumber += 1;
  const suffix = String(testNumber).padStart(12, "0");
  TENANT_A = `00000000-0000-4000-8000-${suffix}`;
  ALICE_ID = `11111111-1111-4111-8111-${suffix}`;
  ALICE_EMAIL = `alice-${testNumber}@recipe.test`;
});

function noteId(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(testNumber * 10 + index).padStart(12, "0")}`;
}

async function seedAlice(opts: { gracePeriodEnd?: Instant; status?: string } = {}): Promise<void> {
  await seedRow(stack.db, userTable, {
    id: ALICE_ID,
    tenantId: TENANT_SYSTEM,
    email: ALICE_EMAIL,
    passwordHash: "h",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: opts.status ?? USER_STATUS.Active,
    gracePeriodEnd: opts.gracePeriodEnd ?? null,
  });
  await seedRow(stack.db, tenantMembershipsTable, {
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

    const remaining = await selectMany(stack.db, notesTable, { tenantId: TENANT_A });
    expect(remaining.length).toBe(0);
  });

  test("Strategy=anonymize: authorId=null, Row bleibt (HR-Compliance-Pfad)", async () => {
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

    const after = await selectMany(stack.db, notesTable, { tenantId: TENANT_A });
    expect(after).toHaveLength(1);
    expect(after[0]?.authorId).toBeNull();
    expect(after[0]?.title).toBe("stays-anonymous");
  });
});
