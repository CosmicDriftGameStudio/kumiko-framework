// Integration test for the user-data-rights-demo sample. Doubles as
// the "Try it" story from the README in code form: everything the README
// explains step by step is run here through real HTTP requests
// and proves itself.
//
// Deliberately also documentation — anyone looking at the sample should see here how
// a Kumiko app wires the GDPR pipeline:
//   - Step 1: user creates todos (todos:write:create)
//   - Step 2: user lists their own todos (todos:query:list)
//   - Step 3: runUserExport → bundle has user + todo entries
//   - Step 4: the registered run-forget-cleanup cron runs after grace
//     → todos gone, user anonymized (the real autonomous path, not the
//     manual helper — so it fires in prod too)

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthEmailPasswordFeature } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { tenantComplianceProfileEntity } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import {
  configValueEntity,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { tenantRetentionOverrideEntity } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import {
  createSessionsFeature,
  userSessionEntity,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import {
  createTenantFeature,
  tenantInvitationEntity,
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
  runForgetCleanup,
  runUserExport,
  UserDataRightsJobs,
} from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { asRawClient, createTenantDb, extractTableName } from "@cosmicdrift/kumiko-framework/db";
import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  createSystemUser,
  EXT_USER_DATA,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefEntity } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { TODO_CREATE_QN, TODO_LIST_QN, todoEntity } from "../feature";
import { APP_FEATURES } from "../run-config";

let stack: TestStack;

const tenantId = testTenantId(1);
const alice = createTestUser({ id: 100, tenantId, roles: ["Member"] });

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const NOW = (): Instant => getTemporal().Now.instant();
const PAST = (): Instant => getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createAuthEmailPasswordFeature({}),
      ...APP_FEATURES,
    ],
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafeCreateEntityTable(stack.db, configValueEntity);
  await unsafeCreateEntityTable(stack.db, todoEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
  // PR #177 made fileRef a standard ES entity (softDelete:
  // true). The hand-maintained CREATE TABLE variant would have had to add the columns
  // is_deleted/deleted_at/deleted_by_id/version/modified_at/modified_by_id
  // — the user-data-rights hook filters on isDeleted:
  // false. Instead of maintaining the schema twice, it now comes from the
  // EntityDefinition.
  await unsafeCreateEntityTable(stack.db, fileRefEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    "store_todos",
    userTable,
    "read_tenant_memberships",
    eventsTable,
  ]);
});

async function seedAlice(userRowOverrides: Record<string, unknown> = {}): Promise<void> {
  await seedRowViaEventStore(stack.db, userTable, {
    id: alice.id,
    email: "alice@demo.local",
    passwordHash: "h",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
    ...userRowOverrides,
  });
  await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
    tenantId: tenantId,
    userId: alice.id,
    roles: '["Member"]',
  });
}

describe("user-data-rights-demo :: end-to-end DSGVO-Story", () => {
  test("Schritt 1+2+3: Todos anlegen → eigene Todos listen → Export-Bundle hat alle Daten", async () => {
    await seedAlice();

    await stack.http.writeOk(
      TODO_CREATE_QN,
      { title: "Steuererklaerung 2025", body: "bis Ende Mai" },
      alice,
    );
    await stack.http.writeOk(
      TODO_CREATE_QN,
      { title: "Auto-Inspektion", body: "naechste Woche" },
      alice,
    );

    const list = await stack.http.queryOk<{
      rows: Array<{ id: string; title: string }>;
    }>(TODO_LIST_QN, {}, alice);
    expect(list.rows).toHaveLength(2);

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: alice.id,
      now: NOW(),
    });
    const tenantSection = bundle.tenants.find((t) => t.tenantId === tenantId);
    expect(tenantSection).toBeDefined();

    const entityNames = (tenantSection?.entities ?? []).map((e) => e.entity);
    expect(entityNames).toContain("user");
    expect(entityNames).toContain("todo");

    const todoSnippet = tenantSection?.entities.find((e) => e.entity === "todo");
    expect(todoSnippet?.rows).toHaveLength(2);
    const titles = (todoSnippet?.rows ?? []).map((r) => String(r["title"]));
    expect(titles).toContain("Steuererklaerung 2025");
    expect(titles).toContain("Auto-Inspektion");
  });

  test("Schritt 4+5: request-deletion → run-forget-cleanup-Cron → todos weg, user anonymisiert", async () => {
    await seedAlice({ status: USER_STATUS.DeletionRequested, gracePeriodEnd: PAST() });
    await stack.http.writeOk(
      TODO_CREATE_QN,
      { title: "vor-deletion-todo", body: "soll weg" },
      alice,
    );

    const forgetCron = stack.registry.getJob(UserDataRightsJobs.runForgetCleanup);
    expect(forgetCron).toBeTruthy();
    const result = await runForgetCleanup({ db: stack.db, registry: stack.registry, now: NOW() });
    expect(result.processedUserIds).toContain(alice.id);
    expect(result.errors).toHaveLength(0);

    // Zweiter User nur fuer den Cron-Wrapper-Pfad (nach dem direkten Helper-
    // Aufruf oben, sonst wuerde der Cron alice schon mitverarbeiten): beweist,
    // dass der registrierte Job selbst — nicht nur runForgetCleanup direkt —
    // ueber die Top-Level-db-Connection loescht, der Pfad der in prod
    // unbeaufsichtigt feuert.
    const cronUser = createTestUser({ id: 101, tenantId, roles: ["Member"] });
    await seedRowViaEventStore(stack.db, userTable, {
      id: cronUser.id,
      email: "cron@demo.local",
      passwordHash: "h",
      displayName: "CronAlice",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: PAST(),
    });
    await forgetCron?.handler({}, {
      // Mirrors the job runner: tenant-filtered db carrying the job's own escapeHatch grant.
      db: createTenantDb({
        db: stack.db,
        tenantId: SYSTEM_TENANT_ID,
        mode: "tenant",
        grants: {
          unsafeRaw: forgetCron?.escapeHatch,
        },
      }),
      registry: stack.registry,
      systemUser: createSystemUser(SYSTEM_TENANT_ID),
      services: { extensions: {} },
      lifecycle: {},
      obs: { log: { warn() {} } },
    } as unknown as JobContext);
    const cronRow = (await asRawClient(stack.db).unsafe(
      `SELECT status FROM read_users WHERE id = $1`,
      [cronUser.id],
    )) as Array<{ status: string }>;
    expect(cronRow[0]?.status).toBe(USER_STATUS.Deleted);

    const remaining = (await asRawClient(stack.db).unsafe(
      `SELECT id FROM store_todos WHERE author_id = $1`,
      [alice.id],
    )) as unknown[];
    expect(remaining).toHaveLength(0);

    const userRows = (await asRawClient(stack.db).unsafe(
      `SELECT email, display_name, status FROM read_users WHERE id = $1`,
      [alice.id],
    )) as Array<{ email: string | null; display_name: string; status: string }>;
    expect(userRows[0]?.status).toBe(USER_STATUS.Deleted);
    expect(userRows[0]?.email).toMatch(/^deleted-.*@anonymized\.invalid$/);
    expect(userRows[0]?.email).not.toContain("alice@demo.local");
  });

  test("anonymize-Strategy: todoDeleteHook sets authorId=null instead of hard-delete", async () => {
    await seedAlice();
    await stack.http.writeOk(
      TODO_CREATE_QN,
      { title: "anonymize-me", body: "row should remain" },
      alice,
    );

    const todoUsage = stack.registry
      .getExtensionUsages(EXT_USER_DATA)
      .find((u) => u.entityName === "todo");
    const hooks = todoUsage?.options as
      | {
          delete?: (
            ctx: { db: typeof stack.db; tenantId: string; userId: string },
            s: "delete" | "anonymize",
          ) => Promise<void>;
        }
      | undefined;
    await hooks?.delete?.(
      { db: stack.db, tenantId: alice.tenantId, userId: alice.id },
      "anonymize",
    );

    const todoRows = (await asRawClient(stack.db).unsafe(
      `SELECT id, title, author_id FROM store_todos`,
    )) as Array<{ id: string; title: string; author_id: string | null }>;
    expect(todoRows).toHaveLength(1);
    expect(todoRows[0]?.title).toBe("anonymize-me");
    expect(todoRows[0]?.author_id).toBeNull();
  });

  // #498/#525: store_todos is a direct-write store (the create handler
  // does insertOne without a lifecycle event). Registered as r.entity it would be a
  // rebuildable implicit projection whose replay finds zero todo events and
  // swaps an empty shadow table over it → every todo (and un-forget of the
  // anonymized rows) would be gone on the next projection rebuild. The
  // r.storeTable registration keeps store_todos OUT of the rebuild set —
  // pinned structurally here: a revert to r.entity would make store_todos show up as a
  // rebuildable projection and fail this test.
  test("store_todos is not a rebuildable projection (r.storeTable guard)", () => {
    expect(stack.registry.getAllProjections().size).toBeGreaterThan(0);
    const rebuildable = [...stack.registry.getAllProjections().values()].some(
      (p) => extractTableName(p.table) === "store_todos",
    );
    expect(rebuildable).toBe(false);
  });
});
