// @runtime dev
// Seed-Daten für die Feature-Reference-Screenshots: damit die entity-Listen
// nicht leer rendern und die öffentlichen Legal-Routes Inhalt haben. Läuft
// nach dem Admin (runDevApp seeds-Hook), idempotent über die seed-Helper.
// Dev-only (importiert die dev-only notes-feature) — wird nur von server.ts
// (runDevApp) als Screenshot-Seed genutzt, nie im Prod-Boot.

import { seedPage } from "@cosmicdrift/kumiko-bundled-features/managed-pages/seeding";
import {
  apiTokenEntity,
  apiTokenTable,
} from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import {
  tagAssignmentAggregateId,
  tagAssignmentEntity,
  tagEntity,
} from "@cosmicdrift/kumiko-bundled-features/tags";
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/text-content/seeding";
import { userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { fetchOne, insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers, unsafeCreateEntityTable } from "@cosmicdrift/kumiko-framework/stack";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { ADMIN_EMAIL, DEMO_NOTE_ID, DEV_TENANT_ID } from "./auth-constants";
import { noteEntity } from "./notes-feature";

// Event-store executors mirror the real handlers (createEntityExecutor pairs the
// projection table + executor), so seeded rows are proper event streams, not
// projection-wiped direct writes. entityName must match the handlers' QNs.
const { executor: tagExecutor } = createEntityExecutor("tag", tagEntity);
const { executor: tagAssignmentExecutor } = createEntityExecutor(
  "tag-assignment",
  tagAssignmentEntity,
);
const { executor: noteExecutor } = createEntityExecutor("note", noteEntity);

// tags + notes + assignments for the tags feature-reference screenshots:
//   - tag-list management screen: colored catalog + non-zero usage counts
//   - note-list: rows to filter via the TagFilter header slot
//   - note-edit: a note carrying chips in its TagSection
// ponytail: no idempotency guard — the screenshot server boots a fresh ephemeral
// DB (KUMIKO_DEV_DB_NAME="") and runs this once; add a fetchOne-by-name guard if
// a persistent dev DB ever reuses the process.
async function seedTagsAndNotes(db: DbConnection, tenantId: TenantId): Promise<void> {
  const by: SessionUser = { ...TestUsers.systemAdmin, tenantId };
  const tdb = createTenantDb(db, tenantId, "system");

  const created = async (
    label: string,
    result: { isSuccess: boolean; data?: unknown },
  ): Promise<string> => {
    if (!result.isSuccess) throw new Error(`seedTagsAndNotes: ${label} failed`);
    const id = (result.data as { id?: string }).id;
    if (id === undefined) throw new Error(`seedTagsAndNotes: ${label} returned no id`);
    return id;
  };

  // scope "" = global (offered on every entity); a value restricts the tag to
  // that entityType in the picker. "billing" never matches a note → proves scope.
  const tags: ReadonlyArray<{ name: string; color: string; scope: string }> = [
    { name: "urgent", color: "#ef4444", scope: "" },
    { name: "backend", color: "#3b82f6", scope: "" },
    { name: "idea", color: "#22c55e", scope: "note" },
    { name: "billing", color: "#a855f7", scope: "invoice" },
  ];
  const tagId: Record<string, string> = {};
  for (const t of tags) {
    tagId[t.name] = await created(
      `tag ${t.name}`,
      await tagExecutor.create({ name: t.name, color: t.color, scope: t.scope }, by, tdb),
    );
  }

  // Note 0 gets a fixed id so the tags-section screenshot can deep-link to it.
  const notes: ReadonlyArray<{ id?: string; title: string }> = [
    { id: DEMO_NOTE_ID, title: "Refactor auth flow" },
    { title: "Q3 budget review" },
    { title: "Landing page copy" },
  ];
  const noteIds: string[] = [];
  for (const n of notes) {
    const data =
      n.id !== undefined
        ? { id: n.id, title: n.title, customFields: {} }
        : { title: n.title, customFields: {} };
    noteIds.push(await created(`note ${n.title}`, await noteExecutor.create(data, by, tdb)));
  }

  const assignments: ReadonlyArray<{ tag: string; note: number }> = [
    { tag: "urgent", note: 0 },
    { tag: "idea", note: 0 },
    { tag: "backend", note: 1 },
  ];
  for (const a of assignments) {
    const entityId = noteIds[a.note];
    if (entityId === undefined) continue;
    const id = tagAssignmentAggregateId(tenantId, tagId[a.tag] ?? "", "note", entityId);
    await created(
      `assign ${a.tag}`,
      await tagAssignmentExecutor.create(
        { id, tagId: tagId[a.tag] ?? "", entityType: "note", entityId },
        by,
        tdb,
      ),
    );
  }
}

async function seedCustomFieldsAndFolders(
  stack: Parameters<SeedFn>[0],
  tenantId: TenantId,
): Promise<void> {
  // custom-fields + folders sind tenant-scoped → TenantAdmin (nicht die
  // Plattform-Rolle SystemAdmin; hasAccess ist exact-match, keine Hierarchie).
  const by: SessionUser = { ...TestUsers.systemAdmin, tenantId, roles: ["TenantAdmin"] };

  await stack.http.writeOk(
    "custom-fields:write:define-tenant-field",
    {
      entityName: "note",
      fieldKey: "priority",
      serializedField: { type: "text" },
      required: false,
      searchable: false,
      displayOrder: 0,
    },
    by,
  );
  await stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    {
      entityName: "note",
      entityId: DEMO_NOTE_ID,
      fieldKey: "priority",
      value: "High",
    },
    by,
  );
  // Generic entity-create strips the unknown `id` field (not an entity column)
  // and generates its own aggregate id → take the returned id for set-folder.
  const folder = await stack.http.writeOk<{ id: string }>(
    "folders:write:folder:create",
    { name: "Inbox" },
    by,
  );
  await stack.http.writeOk(
    "folders:write:set-folder",
    { entityType: "note", entityId: DEMO_NOTE_ID, folderId: folder.id },
    by,
  );
  await stack.eventDispatcher?.runOnce();
}

// personal-access-tokens — the read_api_tokens store is a direct-write table
// that the ephemeral screenshot DB doesn't auto-create (unmanagedTable). Create
// it and seed two demo tokens for the logged-in admin so the "your tokens" list
// renders populated. Screenshot-only: hashes/prefixes are fake, never resolved.
async function seedApiTokens(db: DbConnection, tenantId: TenantId): Promise<void> {
  await unsafeCreateEntityTable(db, apiTokenEntity);
  const admin = await fetchOne<{ id: string }>(db, userTable, { email: ADMIN_EMAIL });
  if (!admin) return;
  const now = Temporal.Now.instant();
  const demo: ReadonlyArray<{ name: string; scopes: string[]; expiresInDays?: number }> = [
    { name: "CI deploy", scopes: ["pages:write", "tags:read"], expiresInDays: 90 },
    { name: "Ledger sync", scopes: ["ledger:read"] },
  ];
  for (const t of demo) {
    await insertOne(db, apiTokenTable, {
      id: generateId(),
      userId: admin.id,
      tenantId,
      name: t.name,
      tokenHash: `demo_${generateId()}`,
      prefix: `kpat_${generateId().slice(0, 6)}`,
      scopes: JSON.stringify(t.scopes),
      createdAt: now,
      expiresAt: t.expiresInDays ? now.add({ hours: 24 * t.expiresInDays }) : null,
      revokedAt: null,
    });
  }
}

const PRIVACY_BODY = [
  "## 1. Controller",
  "",
  "Acme Inc., 123 Example Street, 90001 Sample City.",
  "",
  "## 2. Data we collect",
  "",
  "This app sets **no tracking cookies** and uses no third-party analytics.",
  "",
  "## 3. Your rights (GDPR Art. 15–22)",
  "",
  "Access, rectification, erasure, restriction, portability, objection.",
].join("\n");

export const seedScreenshotData: SeedFn = async (stack) => {
  const devTenant = DEV_TENANT_ID as TenantId;

  // managed-pages — zwei Seiten im Dev-Tenant für den page-list Screen.
  await seedPage(stack.db, {
    tenantId: devTenant,
    slug: "about",
    lang: "en",
    title: "About Acme",
    body: "# About Acme\n\nWe build calm software.",
    published: true,
  });
  await seedPage(stack.db, {
    tenantId: devTenant,
    slug: "pricing",
    lang: "en",
    title: "Pricing",
    body: "# Pricing\n\nSimple, per-seat pricing.",
    published: false,
  });

  // legal-pages — Public-Route /legal/privacy liest den text-block aus dem
  // SYSTEM_TENANT (anonymousAccess.defaultTenantId).
  await seedTextBlock(stack.db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "privacy",
    lang: "en",
    title: "Privacy Policy",
    body: PRIVACY_BODY,
  });

  // tags + notes + assignments in the dev tenant for the tags screenshots.
  await seedTagsAndNotes(stack.db, devTenant);

  // custom-fields + folders extension sections on note-edit.
  await seedCustomFieldsAndFolders(stack, devTenant);

  // personal-access-tokens list for the admin (active tenant = dev).
  await seedApiTokens(stack.db, devTenant);
};
