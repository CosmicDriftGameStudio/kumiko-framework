// User-Data-Rights Recipe — Integration-Test.
//
// Pinst dass die zwei Hooks aus feature.ts genau das tun was die Recipe-
// README verspricht:
//   1. Notes des Users landen via export-Hook im Bundle-Snippet.
//   2. Forget-Cleanup-Cron entfernt die Notes via delete-Hook (strategy
//      "delete", default).
//   3. Strategy "anonymize" (HR-Override) setzt authorId=null statt zu
//      löschen — Row bleibt für Multi-User-Refs intakt.

import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "@cosmicdrift/kumiko-bundled-features/data-retention";
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
import { EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { noteEntity, notesFeature, notesTable } from "../feature";

let stack: TestStack;

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";
const ALICE_ID = "11111111-1111-4111-8111-000000000001";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const NOW = (): Instant => getTemporal().Now.instant();
const PAST = (): Instant => getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
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
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.execute(sql`DELETE FROM read_notes`);
  await stack.db.delete(userTable);
  await stack.db.execute(sql`DELETE FROM read_tenant_memberships`);
});

async function seedAlice(opts: { gracePeriodEnd?: Instant; status?: string } = {}): Promise<void> {
  await stack.db.insert(userTable).values({
    id: ALICE_ID,
    tenantId: TENANT_SYSTEM,
    email: "alice@recipe.test",
    passwordHash: "h",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: opts.status ?? USER_STATUS.Active,
    gracePeriodEnd: opts.gracePeriodEnd ?? null,
  });
  await stack.db.execute(sql`
    INSERT INTO read_tenant_memberships (tenant_id, user_id, roles)
    VALUES (${TENANT_A}, ${ALICE_ID}, '["Member"]')
    ON CONFLICT DO NOTHING
  `);
}

async function seedNote(id: string, title: string): Promise<void> {
  await stack.db.insert(notesTable).values({
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
    await seedNote("aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "first");
    await seedNote("aaaaaaaa-aaaa-4aaa-8aaa-000000000002", "second");

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
    await seedNote("aaaaaaaa-aaaa-4aaa-8aaa-000000000003", "to-delete");

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });
    expect(result.processedUserIds).toContain(ALICE_ID);

    const remaining = await stack.db.execute(sql`SELECT id FROM read_notes`);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
    expect((((remaining as any).rows ?? remaining) as unknown[]).length).toBe(0);
  });

  test("Strategy=anonymize: authorId=null, Row bleibt (HR-Compliance-Pfad)", async () => {
    // Direkter Hook-Call pinnt den anonymize-Vertrag — der Cron-Pfad wird
    // im obigen Test abgedeckt. retention.policyFor entscheidet welche
    // Strategy gilt; hier zeigen wir nur den Hook selber.
    await seedAlice();
    await seedNote("aaaaaaaa-aaaa-4aaa-8aaa-000000000004", "stays-anonymous");

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

    const after = await stack.db.execute(sql`SELECT title, author_id FROM read_notes`);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
    const rows = ((after as any).rows ?? after) as Array<{
      title: string;
      author_id: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.author_id).toBeNull();
    expect(rows[0]?.title).toBe("stays-anonymous");
  });
});
