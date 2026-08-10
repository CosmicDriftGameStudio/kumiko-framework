// formDraftExportHook — GDPR export must scope to the requesting user's own
// drafts only, not every draft in the tenant. formDraftDeleteHook is a
// deliberate no-op (erasure runs via crypto-shredding, see hooks.ts) —
// confirm it doesn't touch the row.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { FormDraftHandlers, formDraftEntity, formDraftFeature } from "../../form-draft";
import { formDraftDeleteHook, formDraftExportHook } from "../hooks";

let stack: TestStack;
const owner = createTestUser({ id: 1, roles: ["TenantMember"] });
const other = createTestUser({ id: 2, roles: ["TenantMember"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [formDraftFeature] });
  await unsafeCreateEntityTable(stack.db, formDraftEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("formDraftExportHook", () => {
  test("includes only the requesting user's own drafts", async () => {
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: "wizard:owner", values: { name: "owner's" }, stepIndex: 0 },
      owner,
    );
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: "wizard:other", values: { name: "other's" }, stepIndex: 0 },
      other,
    );

    const snippet = await formDraftExportHook({
      db: stack.db,
      registry: stack.registry,
      tenantId: owner.tenantId,
      userId: owner.id,
    });

    expect(snippet).not.toBeNull();
    const draftKeys = (snippet?.rows ?? []).map((r) => r["draftKey"]);
    expect(draftKeys).toEqual(["wizard:owner"]);
  });

  test("returns null when the user saved no drafts", async () => {
    const lurker = createTestUser({ id: 3, roles: ["TenantMember"] });
    const snippet = await formDraftExportHook({
      db: stack.db,
      registry: stack.registry,
      tenantId: lurker.tenantId,
      userId: lurker.id,
    });
    expect(snippet).toBeNull();
  });
});

describe("formDraftDeleteHook", () => {
  test("is a no-op — resolves without throwing", async () => {
    const result = await formDraftDeleteHook(
      { db: stack.db, registry: stack.registry, tenantId: owner.tenantId, userId: owner.id },
      "delete",
    );
    expect(result).toBeUndefined();
  });
});
