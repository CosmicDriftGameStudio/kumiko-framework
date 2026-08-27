// Regression for PR #2430 idx 2 (missing-test): tag-screens.boot.test.ts only
// asserts the tag:{create,update,delete} convention aliases are REGISTERED
// (arrayContaining + validateBoot) — never that dispatching them actually
// works. That gap is exactly how idx 1 (wrong-api, feature.ts:76, still OPEN
// at the time this test was added) slipped through: the entityEdit screen
// dispatches the update envelope `{ id, version, changes }`
// (kumiko-screen.tsx:671-678, payloadMode="changes"), but `tag:update` is
// wired to the same flat `updateTagPayloadSchema` as the legacy
// tags:write:update-tag handler. zod strips the unknown `changes` key, the
// schema's `.refine` then has none of name/color/scope and 422s. This test
// dispatches the REAL entityEdit-shaped envelope over HTTP against the alias
// QN, so it stays red until tag:update is routed through the convention
// factory — it is expected to fail until idx 1 is fixed.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { TagsQueries } from "../constants";
import { tagAssignmentEntity, tagEntity } from "../entity";
import { createTagsFeature } from "../feature";

// Alias QNs are not exported as constants (TagsHandlers only carries the
// legacy names) — screens.ts:35 hardcodes "tags:write:tag:delete" the same
// way, so these literals are confirmed ground truth, not guesswork.
const TAG_CREATE_ALIAS = "tags:write:tag:create";
const TAG_UPDATE_ALIAS = "tags:write:tag:update";
const TAG_DELETE_ALIAS = "tags:write:tag:delete";

const tagsFeature = createTagsFeature();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [tagsFeature] });
  await unsafeCreateEntityTable(stack.db, tagEntity);
  await unsafeCreateEntityTable(stack.db, tagAssignmentEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_tags");
  await asRawClient(stack.db).unsafe("DELETE FROM read_tag_assignments");
});

const admin = createTestUser({ roles: ["TenantAdmin"] });

async function tagById(id: string): Promise<Record<string, unknown> | undefined> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    TagsQueries.tagList,
    {},
    admin,
  );
  return res.rows.find((t) => t["id"] === id);
}

async function assignmentsFor(tagId: string): Promise<Array<Record<string, unknown>>> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    TagsQueries.assignmentList,
    { filter: { field: "tagId", op: "eq", value: tagId } },
    admin,
  );
  return res.rows;
}

describe("tags convention-QN contract — entityList/entityEdit aliases", () => {
  test("tag:create dispatches flat values (payloadMode=\"values\") and lands in read_tags", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TAG_CREATE_ALIAS,
      { name: "Konvention" },
      admin,
    );

    const row = await tagById(created.id);
    expect(row?.["name"]).toBe("Konvention");
  });

  test("tag:delete cascades over assignments (must NOT regress to the convention factory's bare delete)", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TAG_CREATE_ALIAS,
      { name: "Kaskade" },
      admin,
    );
    await stack.http.writeOk(
      "tags:write:assign-tag",
      { tagId: created.id, entityType: "credit", entityId: "credit-alias-1" },
      admin,
    );
    expect(await assignmentsFor(created.id)).toHaveLength(1);

    await stack.http.writeOk(TAG_DELETE_ALIAS, { id: created.id }, admin);

    expect(await tagById(created.id)).toBeUndefined();
    expect(await assignmentsFor(created.id)).toHaveLength(0);
  });

  // EXPECTED RED until PR #2430 idx 1 (feature.ts:76) is fixed: entityEdit's
  // real update envelope nests changes under `changes`, not flat fields — the
  // handler behind this alias currently only reads flat name/color/scope.
  test("tag:update dispatches the entityEdit envelope { id, version, changes } and applies the rename", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TAG_CREATE_ALIAS,
      { name: "Alt" },
      admin,
    );
    const version = (await tagById(created.id))?.["version"] as number;

    await stack.http.writeOk(
      TAG_UPDATE_ALIAS,
      { id: created.id, version, changes: { name: "Neu" } },
      admin,
    );

    const after = await tagById(created.id);
    expect(after?.["name"]).toBe("Neu");
  });
});
