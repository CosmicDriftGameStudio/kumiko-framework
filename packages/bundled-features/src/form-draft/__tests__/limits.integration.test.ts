// Proves the two DoS-shaped caps on form-draft save (#1900/2): an unbounded
// `values` blob and unbounded drafts-per-owner both grow the append-only
// event stream without limit. Real Postgres, real dispatch — not hand-fed
// context.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config";
import {
  FORM_DRAFT_MAX_PER_OWNER,
  FORM_DRAFT_VALUES_MAX_BYTES,
  FormDraftHandlers,
} from "../constants";
import { formDraftEntity } from "../entity";
import { formDraftFeature } from "../feature";

let stack: TestStack;

const owner = createTestUser({ id: 1, roles: ["TenantMember"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [formDraftFeature, createConfigFeature()] });
  await unsafeCreateEntityTable(stack.db, formDraftEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_form_drafts");
});

async function saveDraft(draftKey: string, values: Record<string, unknown>) {
  return stack.http.write(FormDraftHandlers.save, { draftKey, values, stepIndex: 0 }, owner);
}

describe("form-draft — values byte cap", () => {
  test(`values at or under ${FORM_DRAFT_VALUES_MAX_BYTES} bytes is accepted`, async () => {
    // Padding value sized so the whole payload lands just under the cap.
    const padding = "x".repeat(FORM_DRAFT_VALUES_MAX_BYTES - 200);
    const res = await saveDraft("wizard:within-cap", { note: padding });
    expect(res.status).toBe(200);
  });

  test(`values exceeding ${FORM_DRAFT_VALUES_MAX_BYTES} bytes is rejected, not silently truncated`, async () => {
    const padding = "x".repeat(FORM_DRAFT_VALUES_MAX_BYTES + 1);
    const res = await saveDraft("wizard:over-cap", { note: padding });
    expect(res.status).toBe(400);

    const rows = await asRawClient(stack.db).unsafe(
      "SELECT count(*)::int AS n FROM read_form_drafts WHERE draft_key = $1",
      ["wizard:over-cap"],
    );
    expect((rows as Array<{ n: number }>)[0]?.n).toBe(0);
  });
});

describe("form-draft — drafts-per-owner cap", () => {
  test(`an owner can create up to ${FORM_DRAFT_MAX_PER_OWNER} drafts, then the next create is rejected`, async () => {
    for (let i = 0; i < FORM_DRAFT_MAX_PER_OWNER; i++) {
      const res = await saveDraft(`wizard:draft-${i}`, { note: "x" });
      expect(res.status).toBe(200);
    }

    const overflow = await saveDraft("wizard:draft-overflow", { note: "x" });
    expect(overflow.status).toBe(422);
    const body = (await overflow.json()) as { error: { details: Record<string, unknown> } };
    expect(body.error.details).toMatchObject({
      reason: "draft_limit_reached",
      limit: FORM_DRAFT_MAX_PER_OWNER,
    });

    const rows = await asRawClient(stack.db).unsafe(
      "SELECT count(*)::int AS n FROM read_form_drafts WHERE owner_id = $1",
      [String(owner.id)],
    );
    expect((rows as Array<{ n: number }>)[0]?.n).toBe(FORM_DRAFT_MAX_PER_OWNER);
  });

  test("updating an existing draft is never blocked by the cap, even at the limit", async () => {
    for (let i = 0; i < FORM_DRAFT_MAX_PER_OWNER; i++) {
      await saveDraft(`wizard:draft-${i}`, { note: "x" });
    }

    const res = await saveDraft("wizard:draft-0", { note: "updated" });
    expect(res.status).toBe(200);
  });

  test("the cap is per-owner, not per-tenant — a different owner is unaffected", async () => {
    for (let i = 0; i < FORM_DRAFT_MAX_PER_OWNER; i++) {
      await saveDraft(`wizard:draft-${i}`, { note: "x" });
    }

    const otherOwner = createTestUser({ id: 2, roles: ["TenantMember"] });
    const res = await stack.http.write(
      FormDraftHandlers.save,
      { draftKey: "wizard:first", values: { note: "x" }, stepIndex: 0 },
      otherOwner,
    );
    expect(res.status).toBe(200);
  });
});
