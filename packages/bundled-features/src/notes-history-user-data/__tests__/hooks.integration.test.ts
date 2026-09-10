// noteEntryExportHook — GDPR export must scope to the requesting user's own
// authored notes only, not every note-entry in the tenant. noteEntryDeleteHook
// is a deliberate no-op (erasure runs via crypto-shredding, see hooks.ts) —
// confirm it doesn't touch the row.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createNotesHistoryFeature, NotesHistoryHandlers } from "../../notes-history";
import { noteEntryEntity } from "../../notes-history/entity";
import { noteEntryDeleteHook, noteEntryExportHook } from "../hooks";

let stack: TestStack;
// Distinct ids (default createTestUser() shares TestUsers.admin.id) —
// this hook's whole point is per-author filtering.
const author = createTestUser({ id: 1, roles: ["TenantMember"] });
const other = createTestUser({ id: 2, roles: ["TenantMember"] });

// fw#2627 made add-note's parent-visibility check unconditional — entityType
// must name a registered entity whose row is visible to the caller. This
// fixture stands in for that parent; it deliberately has no `access` (PASS_CLAUSE)
// so it never gates on its own, keeping this file focused on author filtering.
const CONTACT_TABLE = "notes_user_data_test_contacts";
const contactEntity = createEntity({
  table: CONTACT_TABLE,
  fields: { name: createTextField({ required: true, maxLength: 64 }) },
});
const contactFixtureFeature = defineFeature("notes-user-data-test-contact-fixture", (r) => {
  r.entity("contact", contactEntity);
});

// author and other share the same tenantId (both from TestUsers.admin), so
// one contact row is visible to both.
const CONTACT_1 = "30000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createNotesHistoryFeature(), contactFixtureFeature],
  });
  await unsafeCreateEntityTable(stack.db, noteEntryEntity);
  await unsafeCreateEntityTable(stack.db, contactEntity);
  await createEventsTable(stack.db);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${CONTACT_TABLE} (id, tenant_id, name) VALUES ($1, $2, $3)`,
    [CONTACT_1, author.tenantId, "Contact 1"],
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("noteEntryExportHook", () => {
  test("includes only the requesting user's own authored notes", async () => {
    await stack.http.writeOk(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_1, body: "by author" },
      author,
    );
    await stack.http.writeOk(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_1, body: "by other" },
      other,
    );

    const snippet = await noteEntryExportHook({
      db: stack.db,
      registry: stack.registry,
      tenantId: author.tenantId,
      userId: author.id,
    });

    expect(snippet).not.toBeNull();
    const bodies = (snippet?.rows ?? []).map((r) => r["body"]);
    expect(bodies).toEqual(["by author"]);
    // No read_users row is seeded in this stack, so add-note's self-lookup
    // stamps authorName null — export must still carry the key.
    expect(Object.keys(snippet?.rows?.[0] ?? {})).toContain("authorName");
  });

  test("returns null when the user authored no notes", async () => {
    const lurker = createTestUser({ id: 3, roles: ["TenantMember"] });
    const snippet = await noteEntryExportHook({
      db: stack.db,
      registry: stack.registry,
      tenantId: lurker.tenantId,
      userId: lurker.id,
    });
    expect(snippet).toBeNull();
  });
});

describe("noteEntryDeleteHook", () => {
  test("is a no-op — resolves without throwing", async () => {
    const result = await noteEntryDeleteHook(
      { db: stack.db, registry: stack.registry, tenantId: author.tenantId, userId: author.id },
      "delete",
    );
    expect(result).toBeUndefined();
  });
});
