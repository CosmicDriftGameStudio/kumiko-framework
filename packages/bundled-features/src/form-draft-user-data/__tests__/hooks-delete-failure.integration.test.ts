// formDraftDeleteHook must not silently succeed when a forget run deletes
// every draft row for a user — an Art.17 forget run that reports success
// while PII is still there is a compliance bug, not a display bug.
// The partial-failure case (one delete among several fails) is covered
// mock-free in run-forget-cleanup.integration.test.ts:877; a mock-free way
// to trigger it here would need an optimistic-lock race too fragile to rely on.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config";
import { FormDraftHandlers, formDraftEntity, formDraftFeature } from "../../form-draft";
import { formDraftDeleteHook } from "../hooks";

async function countDraftRows(stack: TestStack, ownerId: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe(
    "SELECT count(*)::int AS n FROM read_form_drafts WHERE owner_id = $1",
    [ownerId],
  );
  return (rows as Array<{ n: number }>)[0]?.n ?? 0;
}

let stack: TestStack;
const alice = createTestUser({ id: 31, roles: ["TenantMember"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [formDraftFeature, createConfigFeature()] });
  await unsafeCreateEntityTable(stack.db, formDraftEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("formDraftDeleteHook — delete failure handling (#review-batch-fw-1)", () => {
  test("does not throw when every delete succeeds", async () => {
    const bob = createTestUser({ id: 32, roles: ["TenantMember"], tenantId: alice.tenantId });
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: "wizard:bob-ok", values: {}, stepIndex: 0 },
      bob,
    );

    await expect(
      formDraftDeleteHook(
        { db: stack.db, registry: stack.registry, tenantId: bob.tenantId, userId: bob.id },
        "delete",
      ),
    ).resolves.toBeUndefined();

    expect(await countDraftRows(stack, String(bob.id))).toBe(0);
  });
});
