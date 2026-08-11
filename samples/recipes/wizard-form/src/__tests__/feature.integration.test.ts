// Wizard Form Sample — Integration Test
// Proves: the listing entity + wizard-mode screen boot together (the
// boot-validator's wizard rules — >= 2 titled sections, draft: true only
// with mode: "wizard" and form-draft mounted — all pass for this feature
// combination), the entity's CRUD create works end-to-end, and the
// form-draft save/get/discard round-trip that backs `draft: true` behaves
// exactly as a resumed-then-submitted wizard would use it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  FormDraftHandlers,
  FormDraftQueries,
  formDraftEntity,
  formDraftFeature,
} from "@cosmicdrift/kumiko-bundled-features/form-draft";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { listingEntity, listingsFeature } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;
const otherUser = createTestUser({ id: 2, roles: ["Admin"] });

// Arbitrary draftKey for exercising the handler contract directly — this
// suite calls FormDraftHandlers/FormDraftQueries with an explicit key, it
// doesn't go through RenderEdit's client-side derivation (which mints its
// own `${screenId}:new:${draftId}` for a create-mode wizard, issue #1913).
const DRAFT_KEY = "listing-wizard";

beforeAll(async () => {
  // form-draft requires the "config" feature (its retention-days setting).
  stack = await setupTestStack({
    features: [listingsFeature, formDraftFeature, createConfigFeature()],
  });
  await unsafeCreateEntityTable(stack.db, listingEntity);
  await unsafeCreateEntityTable(stack.db, formDraftEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("listing:create", () => {
  test("creates a listing with the wizard's fields", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "listings:write:listing:create",
      { title: "Vintage desk lamp", category: "furniture", price: 42, condition: "used" },
      admin,
    );

    expect(created.data["title"]).toBe("Vintage desk lamp");
    expect(created.data["category"]).toBe("furniture");
    expect(created.data["price"]).toBe(42);
    expect(created.data["condition"]).toBe("used");
  });

  test("condition defaults to used when omitted", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "listings:write:listing:create",
      { title: "Old bicycle", category: "vehicles", price: 80 },
      admin,
    );

    expect(created.data["condition"]).toBe("used");
  });
});

describe("wizard draft resume", () => {
  test("save persists the in-progress steps, get resumes them", async () => {
    await stack.http.writeOk(
      FormDraftHandlers.save,
      {
        draftKey: DRAFT_KEY,
        values: { title: "Draft title", category: "electronics" },
        stepIndex: 1,
      },
      admin,
    );

    const resumed = await stack.http.queryOk<{ draft: { values: Record<string, unknown> } | null }>(
      FormDraftQueries.get,
      { draftKey: DRAFT_KEY },
      admin,
    );

    expect(resumed.draft?.values["title"]).toBe("Draft title");
    expect(resumed.draft?.values["category"]).toBe("electronics");
  });

  test("a later save overwrites the earlier one, not duplicates it", async () => {
    const key = "listing-wizard:overwrite";
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: key, values: { title: "First pass" }, stepIndex: 0 },
      admin,
    );
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: key, values: { title: "Second pass", category: "other" }, stepIndex: 1 },
      admin,
    );

    const resumed = await stack.http.queryOk<{ draft: { values: Record<string, unknown> } | null }>(
      FormDraftQueries.get,
      { draftKey: key },
      admin,
    );

    expect(resumed.draft?.values["title"]).toBe("Second pass");
  });

  test("discard clears the draft — the next get resolves null, same as a completed submit", async () => {
    const key = "listing-wizard:discard";
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: key, values: { title: "About to submit" }, stepIndex: 2 },
      admin,
    );

    await stack.http.writeOk(FormDraftHandlers.discard, { draftKey: key }, admin);

    const afterDiscard = await stack.http.queryOk<{ draft: unknown }>(
      FormDraftQueries.get,
      { draftKey: key },
      admin,
    );
    expect(afterDiscard.draft).toBeNull();
  });

  test("a foreign user's get never resolves another user's draft", async () => {
    const key = "listing-wizard:isolated";
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: key, values: { title: "Only mine" }, stepIndex: 0 },
      admin,
    );

    const foreign = await stack.http.queryOk<{ draft: unknown }>(
      FormDraftQueries.get,
      { draftKey: key },
      otherUser,
    );
    expect(foreign.draft).toBeNull();
  });
});
