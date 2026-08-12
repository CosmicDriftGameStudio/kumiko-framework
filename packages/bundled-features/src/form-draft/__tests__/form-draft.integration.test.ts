// Full-stack integration for the form-draft bundle. Drives save → get →
// discard through the real dispatcher + entity-projection + DB:
//   - save upserts (tenantId, ownerId, draftKey) — a second save for the
//     same key updates the existing row, it never duplicates
//   - get resolves { draft: null } for a foreign user / foreign tenant,
//     never leaking the other owner's row
//   - discard only ever removes the caller's own row
//   - stepIndex + savedAt round-trip through the blob shape fixed by #1889
//   - list resolves a user's open drafts for a screenId (draftKey prefix
//     match), never another user's/tenant's rows and never the blob values

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
import { FormDraftHandlers, FormDraftQueries } from "../constants";
import { formDraftEntity } from "../entity";
import { formDraftFeature } from "../feature";
import type { GetDraftResult } from "../handlers/get.query";
import type { ListDraftsResult } from "../handlers/list.query";

let stack: TestStack;

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

// Distinct ids (default createTestUser() shares TestUsers.admin.id).
const owner = createTestUser({ id: 1, roles: ["TenantMember"] });
const otherUser = createTestUser({ id: 2, roles: ["TenantMember"] });
const otherTenant = createTestUser({
  id: 1,
  roles: ["TenantMember"],
  tenantId: "00000000-0000-4000-8000-0000000000aa",
});

async function saveDraft(
  draftKey: string,
  values: Record<string, unknown>,
  stepIndex: number,
  user = owner,
): Promise<unknown> {
  return stack.http.writeOk(FormDraftHandlers.save, { draftKey, values, stepIndex }, user);
}

async function getDraft(draftKey: string, user = owner): Promise<GetDraftResult> {
  return stack.http.queryOk<GetDraftResult>(FormDraftQueries.get, { draftKey }, user);
}

async function discardDraft(draftKey: string, user = owner): Promise<unknown> {
  return stack.http.writeOk(FormDraftHandlers.discard, { draftKey }, user);
}

async function listDrafts(screenId: string, user = owner): Promise<ListDraftsResult> {
  return stack.http.queryOk<ListDraftsResult>(FormDraftQueries.list, { screenId }, user);
}

describe("form-draft integration — save + get", () => {
  test("save then get round-trips values, stepIndex, and a stamped savedAt", async () => {
    await saveDraft("wizard:vehicle-create", { name: "Van" }, 1);
    const { draft } = await getDraft("wizard:vehicle-create");
    expect(draft).not.toBeNull();
    expect(draft?.values).toEqual({ name: "Van" });
    expect(draft?.stepIndex).toBe(1);
    expect(draft?.savedAt).toBeTruthy();
  });

  test("get resolves { draft: null } when nothing was ever saved", async () => {
    const { draft } = await getDraft("no-such-draft");
    expect(draft).toBeNull();
  });

  test("savedAt is always a fresh server-side stamp, not a client-supplied value", async () => {
    await stack.http.writeOk(
      FormDraftHandlers.save,
      {
        draftKey: "wizard:x",
        values: {},
        stepIndex: 0,
        savedAt: "1999-01-01T00:00:00Z",
      },
      owner,
    );
    const { draft } = await getDraft("wizard:x");
    const savedAtMs = draft?.savedAt ? Date.parse(draft.savedAt) : Number.NaN;
    expect(Number.isNaN(savedAtMs)).toBe(false);
    expect(Date.now() - savedAtMs).toBeLessThan(10_000);
  });
});

describe("form-draft integration — save is an upsert", () => {
  test("saving the same draftKey twice updates the row, it never duplicates", async () => {
    await saveDraft("wizard:vehicle-create", { name: "Van" }, 0);
    await saveDraft("wizard:vehicle-create", { name: "Van", plate: "B-XY-123" }, 2);

    const { draft } = await getDraft("wizard:vehicle-create");
    expect(draft?.values).toEqual({ name: "Van", plate: "B-XY-123" });
    expect(draft?.stepIndex).toBe(2);

    const rows = await asRawClient(stack.db).unsafe(
      "SELECT count(*)::int AS n FROM read_form_drafts WHERE draft_key = $1",
      ["wizard:vehicle-create"],
    );
    expect((rows as Array<{ n: number }>)[0]?.n).toBe(1);
  });

  test("two different users saving the same draftKey each get their own draft", async () => {
    await saveDraft("wizard:shared-key", { name: "Owner's" }, 0, owner);
    await saveDraft("wizard:shared-key", { name: "Other's" }, 3, otherUser);

    expect((await getDraft("wizard:shared-key", owner)).draft?.values).toEqual({
      name: "Owner's",
    });
    expect((await getDraft("wizard:shared-key", otherUser)).draft?.values).toEqual({
      name: "Other's",
    });
  });
});

describe("form-draft integration — discard", () => {
  test("discard removes the draft — a subsequent get resolves null", async () => {
    await saveDraft("wizard:to-discard", { name: "Gone soon" }, 0);
    await discardDraft("wizard:to-discard");
    expect((await getDraft("wizard:to-discard")).draft).toBeNull();
  });

  test("discarding a draftKey that was never saved is a no-op, not an error", async () => {
    await discardDraft("wizard:never-saved");
    expect((await getDraft("wizard:never-saved")).draft).toBeNull();
  });
});

describe("form-draft integration — ownership isolation", () => {
  test("a foreign user's get never sees another user's draft", async () => {
    await saveDraft("wizard:private", { secret: "only mine" }, 0, owner);
    expect((await getDraft("wizard:private", otherUser)).draft).toBeNull();
  });

  test("a foreign user's discard never removes another user's draft", async () => {
    await saveDraft("wizard:private", { secret: "only mine" }, 0, owner);
    await discardDraft("wizard:private", otherUser);
    expect((await getDraft("wizard:private", owner)).draft?.values).toEqual({
      secret: "only mine",
    });
  });

  test("a foreign user's save under the same draftKey creates its own row, never overwrites", async () => {
    await saveDraft("wizard:private", { secret: "only mine" }, 0, owner);
    await saveDraft("wizard:private", { secret: "not mine" }, 5, otherUser);
    expect((await getDraft("wizard:private", owner)).draft?.values).toEqual({
      secret: "only mine",
    });
    expect((await getDraft("wizard:private", otherUser)).draft?.values).toEqual({
      secret: "not mine",
    });
  });

  test("a foreign tenant's get never sees another tenant's draft, even with the same user id", async () => {
    await saveDraft("wizard:tenant-scoped", { secret: "tenant A" }, 0, owner);
    expect((await getDraft("wizard:tenant-scoped", otherTenant)).draft).toBeNull();
    expect((await getDraft("wizard:tenant-scoped", owner)).draft?.values).toEqual({
      secret: "tenant A",
    });
  });
});

describe("form-draft integration — list", () => {
  test("list returns open drafts for a screenId, newest first, without the blob's values", async () => {
    await saveDraft("wizard:a", { name: "First" }, 0);
    // savedAt is a millisecond stamp (#1960) — sleep is best-effort only;
    // under CI load two saves can still tie, so assert the comparator
    // contract (savedAt desc, then id desc) rather than a fixed key order.
    await Bun.sleep(20);
    await saveDraft("wizard:b", { name: "Second" }, 1);

    const { drafts } = await listDrafts("wizard");
    expect(drafts).toHaveLength(2);
    expect(new Set(drafts.map((d) => d.draftKey))).toEqual(new Set(["wizard:a", "wizard:b"]));
    const [first, second] = drafts;
    expect(first?.savedAt).toBeTruthy();
    expect(first).not.toHaveProperty("values");
    const byTime = second!.savedAt.localeCompare(first!.savedAt);
    const byId = second!.id.localeCompare(first!.id);
    expect(byTime < 0 || (byTime === 0 && byId < 0)).toBe(true);
    if (first!.draftKey === "wizard:b") expect(first!.stepIndex).toBe(1);
  });

  test("list excludes a draft whose screenId is only a prefix, not a full segment match", async () => {
    await saveDraft("wizard:a", {}, 0);
    await saveDraft("wizardry:x", {}, 0);

    const { drafts } = await listDrafts("wizard");
    expect(drafts.map((d) => d.draftKey)).toEqual(["wizard:a"]);
  });

  test("a screenId containing LIKE metacharacters is matched literally, not as a wildcard", async () => {
    await saveDraft("scr%en:a", {}, 0);
    await saveDraft("wizard:a", {}, 0);

    const { drafts } = await listDrafts("scr%en");
    expect(drafts.map((d) => d.draftKey)).toEqual(["scr%en:a"]);
  });

  test("a screenId containing an underscore is matched literally, not as a single-char wildcard", async () => {
    await saveDraft("wizar_:a", {}, 0);
    await saveDraft("wizardX:a", {}, 0);

    const { drafts } = await listDrafts("wizar_");
    expect(drafts.map((d) => d.draftKey)).toEqual(["wizar_:a"]);
  });

  test("a screenId containing a literal backslash is matched literally", async () => {
    await saveDraft("wiz\\ard:a", {}, 0);
    await saveDraft("wizard:a", {}, 0);

    const { drafts } = await listDrafts("wiz\\ard");
    expect(drafts.map((d) => d.draftKey)).toEqual(["wiz\\ard:a"]);
  });

  test("list resolves an empty array when nothing was ever saved for the screenId", async () => {
    expect((await listDrafts("no-such-screen")).drafts).toEqual([]);
  });

  test("list excludes another user's drafts for the same screenId", async () => {
    await saveDraft("wizard:mine", { secret: "only mine" }, 0, owner);
    await saveDraft("wizard:theirs", { secret: "not mine" }, 0, otherUser);

    expect((await listDrafts("wizard", owner)).drafts.map((d) => d.draftKey)).toEqual([
      "wizard:mine",
    ]);
    expect((await listDrafts("wizard", otherUser)).drafts.map((d) => d.draftKey)).toEqual([
      "wizard:theirs",
    ]);
  });

  test("list excludes another tenant's drafts, even with the same user id", async () => {
    await saveDraft("wizard:tenant-a", { secret: "tenant A" }, 0, owner);
    expect((await listDrafts("wizard", otherTenant)).drafts).toEqual([]);
  });
});
