// noteEntryExportHook — GDPR export must scope to the requesting user's own
// authored notes only, not every note-entry in the tenant. noteEntryDeleteHook
// is a deliberate no-op (erasure runs via crypto-shredding, see hooks.ts) —
// confirm it doesn't touch the row.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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

beforeAll(async () => {
  stack = await setupTestStack({ features: [createNotesHistoryFeature()] });
  await unsafeCreateEntityTable(stack.db, noteEntryEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("noteEntryExportHook", () => {
  test("includes only the requesting user's own authored notes", async () => {
    await stack.http.writeOk(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: "c-1", body: "by author" },
      author,
    );
    await stack.http.writeOk(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: "c-1", body: "by other" },
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
