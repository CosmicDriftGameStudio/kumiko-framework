// Integration-Test fuer das user-data-rights-demo Sample. Ist gleichzeitig
// die "Try it"-Story aus dem README in code-Form: alles was die README
// Schritt-fuer-Schritt erklaert, wird hier durch echte HTTP-Requests
// gefahren und beweist sich selbst.
//
// Bewusst auch eine Doku — wer das Sample anschaut soll hier sehen wie
// eine Kumiko-App DSGVO-Pipeline verdrahtet:
//   - Schritt 1: User legt Todos an (todos:write:create)
//   - Schritt 2: User listet eigene Todos (todos:query:list)
//   - Schritt 3: runUserExport → Bundle hat user + todo entries
//   - Schritt 4: runForgetCleanup nach grace → todos weg, user anonymisiert

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthEmailPasswordFeature } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { tenantComplianceProfileEntity } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { tenantRetentionOverrideEntity } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  createUserFeature,
  USER_STATUS,
  userEntity,
  userTable,
} from "@cosmicdrift/kumiko-bundled-features/user";
import {
  runForgetCleanup,
  runUserExport,
} from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { asRawClient, insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { fileRefEntity } from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
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
      createSessionsFeature(),
      createAuthEmailPasswordFeature({}),
      ...APP_FEATURES,
    ],
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, todoEntity);
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
  await unsafeCreateEntityTable(stack.db, fileRefEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM read_todos`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_memberships`);
  await asRawClient(stack.db).unsafe(`DELETE FROM kumiko_events`);
});

async function seedAlice(): Promise<void> {
  await insertOne(stack.db, userTable, {
    id: alice.id,
    tenantId: alice.tenantId,
    email: "alice@demo.local",
    passwordHash: "h",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
  });
  await asRawClient(stack.db).unsafe(
    `
    INSERT INTO read_tenant_memberships (tenant_id, user_id, roles)
    VALUES ($1, $2, '["Member"]')
    ON CONFLICT (user_id, tenant_id) DO NOTHING
  `,
    [tenantId, alice.id],
  );
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

  test("Schritt 4+5: request-deletion → Forget-Cleanup → todos weg, user anonymisiert", async () => {
    await seedAlice();
    await stack.http.writeOk(
      TODO_CREATE_QN,
      { title: "vor-deletion-todo", body: "soll weg" },
      alice,
    );

    await asRawClient(stack.db).unsafe(
      `
      UPDATE read_users SET status = $1, grace_period_end = $2::timestamptz
      WHERE id = $3
    `,
      [USER_STATUS.DeletionRequested, PAST().toString(), alice.id],
    );

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });
    expect(result.processedUserIds).toContain(alice.id);
    expect(result.errors).toHaveLength(0);

    const remaining = (await asRawClient(stack.db).unsafe(
      `SELECT id FROM read_todos WHERE author_id = $1`,
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

  test("anonymize-Strategy: todoDeleteHook setzt authorId=null statt hard-delete", async () => {
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
      `SELECT id, title, author_id FROM read_todos`,
    )) as Array<{ id: string; title: string; author_id: string | null }>;
    expect(todoRows).toHaveLength(1);
    expect(todoRows[0]?.title).toBe("anonymize-me");
    expect(todoRows[0]?.author_id).toBeNull();
  });
});
