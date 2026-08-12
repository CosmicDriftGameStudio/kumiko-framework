// formDraftDeleteHook must not silently succeed when one of several
// formDraftExecutor.delete calls fails — an Art.17 forget run that reports
// success while a draft row (and its PII) is still there is a compliance
// bug, not a display bug. Mocks formDraftExecutor.delete for exactly one
// row's id to force a realistic partial-failure without needing to
// engineer an actual optimistic-lock race.
//
// Restore hygiene: Bun runs a test-run's files in one process, so a
// top-level mock.module leaks into every file that runs after this one —
// mock BEFORE importing "../hooks" (so it picks up the mocked executor),
// capture the real module first, and restore it in afterAll.

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
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

const realFormDraft = await import("../../form-draft");

// Ids the mocked executor should fail to delete — populated per-test before
// formDraftDeleteHook runs, read at call-time (not factory-time).
const failingIds = new Set<string>();

const realDelete: typeof realFormDraft.formDraftExecutor.delete =
  realFormDraft.formDraftExecutor.delete;

const mockedDelete: typeof realFormDraft.formDraftExecutor.delete = async (payload, user, db) => {
  if (failingIds.has(String(payload.id))) {
    return {
      isSuccess: false as const,
      error: {
        code: "internal_error",
        httpStatus: 500,
        i18nKey: "errors.internal",
        message: `synthetic delete failure for ${payload.id}`,
      },
    };
  }
  return realDelete(payload, user, db);
};

mock.module("../../form-draft", () => ({
  ...realFormDraft,
  formDraftExecutor: { ...realFormDraft.formDraftExecutor, delete: mockedDelete },
}));

const { formDraftDeleteHook } = await import("../hooks");

afterAll(() => {
  mock.module("../../form-draft", () => realFormDraft);
});

async function draftIdFor(stack: TestStack, draftKey: string): Promise<string> {
  const rows = await asRawClient(stack.db).unsafe(
    "SELECT id FROM read_form_drafts WHERE draft_key = $1",
    [draftKey],
  );
  const row = (rows as Array<{ id: string }>)[0];
  if (!row) throw new Error(`no draft row for ${draftKey}`);
  return row.id;
}

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
  test("throws instead of reporting success when one of several deletes fails, leaves the failed row in place", async () => {
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: "wizard:keep-ok", values: {}, stepIndex: 0 },
      alice,
    );
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: "wizard:keep-fail", values: {}, stepIndex: 0 },
      alice,
    );
    const failId = await draftIdFor(stack, "wizard:keep-fail");
    failingIds.add(failId);

    await expect(
      formDraftDeleteHook(
        { db: stack.db, registry: stack.registry, tenantId: alice.tenantId, userId: alice.id },
        "delete",
      ),
    ).rejects.toThrow(/failed to delete draft/);

    // The successful delete already committed via the real executor
    // (formDraftExecutor writes its own event + projection transaction per
    // row); only the row the mocked delete refused to remove remains.
    expect(await countDraftRows(stack, String(alice.id))).toBe(1);

    failingIds.delete(failId);
  });

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
