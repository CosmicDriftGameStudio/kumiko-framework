// ownership.write on tag-assignment must gate assign-tag (create/restore) and
// remove-tag (delete), not only the framework's generic paths. The rule below
// lets a user write only assignments whose host entityId is their own user id.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEntity,
  createTextField,
  defineFeature,
  from,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { TagsHandlers } from "../constants.js";
import { tagAssignmentEntity, tagEntity } from "../entity.js";
import { createTagsFeature } from "../feature.js";

const PROJECT_TABLE = "tags_ow_test_projects";

const projectEntity = createEntity({
  table: PROJECT_TABLE,
  fields: {
    name: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

const hostFixturesFeature = defineFeature("tags-ow-test-fixtures", (r) => {
  r.entity("project", projectEntity);
});

const owner = createTestUser({ id: 80, roles: ["TenantMember"] });
const stranger = createTestUser({ id: 81, roles: ["TenantMember"] });

let stack: TestStack;
let tagId: string;

function activeAssignmentCount(): Promise<number> {
  return asRawClient(stack.db)
    .unsafe<{ n: number }>(
      "SELECT count(*)::int AS n FROM read_tag_assignments WHERE tag_id = $1 AND entity_id = $2 AND is_deleted = FALSE",
      [tagId, owner.id],
    )
    .then((rows) => rows[0]?.n ?? 0);
}

const assignment = () => ({ tagId, entityType: "project", entityId: owner.id });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createTagsFeature({
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        ownership: { write: { TenantMember: from("user:id", "entityId") } },
      }),
      hostFixturesFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, tagEntity);
  await unsafeCreateEntityTable(stack.db, tagAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, projectEntity);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, name) VALUES ($1, $3, 'own'), ($2, $3, 'other')`,
    [owner.id, stranger.id, owner.tenantId],
  );
  const tag = await stack.http.writeOk<{ id: string }>(
    TagsHandlers.createTag,
    { name: "Owned" },
    owner,
  );
  tagId = tag.id;
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tags — ownership.write gates assign-tag and remove-tag", () => {
  test("a caller outside the write rule cannot create an assignment", async () => {
    const err = await stack.http.writeErr(TagsHandlers.assignTag, assignment(), stranger);
    expectErrorIncludes(err, "ownership_denied");
    expect(await activeAssignmentCount()).toBe(0);
  });

  test("a caller inside the write rule can assign and remove", async () => {
    await stack.http.writeOk(TagsHandlers.assignTag, assignment(), owner);
    expect(await activeAssignmentCount()).toBe(1);

    await stack.http.writeOk(TagsHandlers.removeTag, assignment(), owner);
    expect(await activeAssignmentCount()).toBe(0);
  });

  test("a caller outside the write rule cannot remove an assignment", async () => {
    await stack.http.writeOk(TagsHandlers.assignTag, assignment(), owner);

    const err = await stack.http.writeErr(TagsHandlers.removeTag, assignment(), stranger);
    expectErrorIncludes(err, "ownership_denied");
    expect(await activeAssignmentCount()).toBe(1);
  });

  test("a caller outside the write rule cannot restore a removed assignment", async () => {
    await stack.http.writeOk(TagsHandlers.removeTag, assignment(), owner);
    expect(await activeAssignmentCount()).toBe(0);

    const err = await stack.http.writeErr(TagsHandlers.assignTag, assignment(), stranger);
    expectErrorIncludes(err, "ownership_denied");
    expect(await activeAssignmentCount()).toBe(0);
  });
});
