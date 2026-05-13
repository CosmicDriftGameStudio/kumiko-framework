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

import { createAuthEmailPasswordFeature } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { tenantComplianceProfileEntity } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { tenantRetentionOverrideEntity } from "@cosmicdrift/kumiko-bundled-features/data-retention";
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
import { EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { TODO_CREATE_QN, TODO_LIST_QN, todoEntity } from "../feature";
import { APP_FEATURES } from "../run-config";

let stack: TestStack;

const tenantId = testTenantId(1);
const alice = createTestUser({ id: 100, tenantId, roles: ["Member"] });

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const NOW = (): Instant => getTemporal().Now.instant();
const PAST = (): Instant => getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);

beforeAll(async () => {
  // setupTestStack ergaenzt config/user/tenant/auth NICHT automatisch
  // (anders als runDevApp via composeFeatures). Wir mounten sie hier
  // explicit, sonst scheitert file-foundation.requires("config").
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature({}),
      ...APP_FEATURES,
    ],
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, todoEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await stack.db.execute(sql`
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
  await stack.db.execute(sql`
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
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.execute(sql`DELETE FROM read_todos`);
  await stack.db.delete(userTable);
  await stack.db.execute(sql`DELETE FROM read_tenant_memberships`);
  await stack.db.execute(sql`DELETE FROM kumiko_events`);
});

async function seedAlice(): Promise<void> {
  await stack.db.insert(userTable).values({
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
  await stack.db.execute(sql`
    INSERT INTO read_tenant_memberships (tenant_id, user_id, roles)
    VALUES (${tenantId}, ${alice.id}, '["Member"]')
    ON CONFLICT (user_id, tenant_id) DO NOTHING
  `);
}

describe("user-data-rights-demo :: end-to-end DSGVO-Story", () => {
  test("Schritt 1+2+3: Todos anlegen → eigene Todos listen → Export-Bundle hat alle Daten", async () => {
    await seedAlice();

    // Schritt 1: User legt zwei Todos an.
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

    // Schritt 2: User listet eigene Todos.
    const list = await stack.http.queryOk<{
      rows: Array<{ id: string; title: string }>;
    }>(TODO_LIST_QN, {}, alice);
    expect(list.rows).toHaveLength(2);

    // Schritt 3: runUserExport baut das Bundle (in der echten App ueber
    // request-export-Job gefahren; hier rufen wir den Runner direkt fuer
    // Determinismus). Bundle enthaelt user + todo (kein fileRef weil keine
    // Files).
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

    // Direkt-flip auf DeletionRequested + abgelaufene Grace, damit wir den
    // Cron-Lauf testen ohne 30 Tage zu warten. In der echten App passiert
    // das ueber request-deletion.write + abgelaufene grace_period_end.
    await stack.db.execute(sql`
      UPDATE read_users SET status = ${USER_STATUS.DeletionRequested},
                             grace_period_end = ${PAST().toString()}::timestamptz
      WHERE id = ${alice.id}
    `);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });
    expect(result.processedUserIds).toContain(alice.id);
    expect(result.errors).toHaveLength(0);

    // Todos weg.
    const remaining = await stack.db.execute(sql`
      SELECT id FROM read_todos WHERE author_id = ${alice.id}
    `);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
    expect(((remaining as any).rows ?? remaining) as unknown[]).toHaveLength(0);

    // User anonymisiert.
    const userRow = await stack.db.execute(sql`
      SELECT email, display_name, status FROM read_users WHERE id = ${alice.id}
    `);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
    const rows = ((userRow as any).rows ?? userRow) as Array<{
      email: string | null;
      display_name: string;
      status: string;
    }>;
    expect(rows[0]?.status).toBe(USER_STATUS.Deleted);
    // Default user-Anonymisierung ersetzt email mit Sentinel-Pattern
    // "deleted-<id>@anonymized.invalid" — original PII raus, FK-Refs
    // und unique-Constraint bleiben intakt.
    expect(rows[0]?.email).toMatch(/^deleted-.*@anonymized\.invalid$/);
    expect(rows[0]?.email).not.toContain("alice@demo.local");
  });

  test("anonymize-Strategy: todoDeleteHook setzt authorId=null statt hard-delete", async () => {
    // Direct-Hook-Test: belegt dass deleteTodos die Strategy respektiert.
    // (runForgetCleanup waehlt Strategy via retention.policyFor; hier
    // pinnen wir den Hook-Vertrag — App-Author kopiert das Pattern.)
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

    // Row existiert weiter, authorId=null.
    const after = await stack.db.execute(sql`
      SELECT id, title, author_id FROM read_todos
    `);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
    const todoRows = ((after as any).rows ?? after) as Array<{
      id: string;
      title: string;
      author_id: string | null;
    }>;
    expect(todoRows).toHaveLength(1);
    expect(todoRows[0]?.title).toBe("anonymize-me");
    expect(todoRows[0]?.author_id).toBeNull();
  });
});
