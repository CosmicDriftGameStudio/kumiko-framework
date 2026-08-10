// formDraftExportHook — GDPR export must scope to the requesting user's own
// drafts only, not every draft in the tenant. formDraftDeleteHook physically
// deletes the requesting user's own draft rows and must leave other users'
// (and other tenants') rows untouched.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { FormDraftHandlers, formDraftEntity, formDraftFeature } from "../../form-draft";
import { formDraftDeleteHook, formDraftExportHook } from "../hooks";

async function countDraftRows(stack: TestStack, ownerId: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe(
    "SELECT count(*)::int AS n FROM read_form_drafts WHERE owner_id = $1",
    [ownerId],
  );
  return (rows as Array<{ n: number }>)[0]?.n ?? 0;
}

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
  test("deletes the requesting user's own draft rows, leaves other users' rows alone", async () => {
    const alice = createTestUser({ id: 11, roles: ["TenantMember"] });
    const bob = createTestUser({ id: 12, roles: ["TenantMember"], tenantId: alice.tenantId });
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: "wizard:a", values: {}, stepIndex: 0 },
      alice,
    );
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: "wizard:b", values: {}, stepIndex: 0 },
      bob,
    );

    await formDraftDeleteHook(
      { db: stack.db, registry: stack.registry, tenantId: alice.tenantId, userId: alice.id },
      "delete",
    );

    expect(await countDraftRows(stack, String(alice.id))).toBe(0);
    expect(await countDraftRows(stack, String(bob.id))).toBe(1);
  });

  test("is idempotent — running it again with nothing left to delete does not throw", async () => {
    const lurker = createTestUser({ id: 13, roles: ["TenantMember"] });
    await expect(
      formDraftDeleteHook(
        { db: stack.db, registry: stack.registry, tenantId: lurker.tenantId, userId: lurker.id },
        "delete",
      ),
    ).resolves.toBeUndefined();
  });
});
