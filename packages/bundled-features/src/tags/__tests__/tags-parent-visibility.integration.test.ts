// assign-tag/remove-tag previously took entityType/entityId straight from the
// client, so any dispatch-eligible tenant user could attach a catalog tag to —
// or detach one from — an object they had no read access to. The tag-assignment
// aggregate-id is derived from the tenant, so this was never a cross-tenant
// hole; it was "tag an object inside your own tenant that you aren't allowed to
// read", which also leaks through the assignment list of anyone who can see it.
//
// The check is unconditional (default-on, no opt-in): entityType must name a
// registered entity, and the host row must be visible through that entity's own
// read path (tenant scope plus its `access.read` ownership). tag:delete applies the
// same visibility rule to its cascade and refuses while a record the caller cannot
// see carries the tag.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { tagAssignmentEntity, tagEntity } from "../entity.ts";
import { createTagsFeature } from "../feature.ts";
import { TagsHandlers } from "../web/constants.ts";

const PROJECT_TABLE = "tags_pv_test_projects";

// Team-scoped read ownership on the host entity itself — the caller sees a
// project row only if their `team` claim matches the row's team_id.
const projectOwnership: NonNullable<EntityDefinition["access"]> = {
  read: {
    TenantMember: {
      kind: "where",
      where: (user, ctx) => ({
        sqlText: `${ctx.tableName}.team_id = $${ctx.paramStart}`,
        params: [user.claims?.["team"] ?? null],
      }),
    },
  },
};

const projectEntity = createEntity({
  table: PROJECT_TABLE,
  fields: {
    teamId: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
    name: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
  access: projectOwnership,
});

const hostFixturesFeature = defineFeature("tags-pv-test-fixtures", (r) => {
  r.entity({ name: "project", ...projectEntity });
});

type TestUser = ReturnType<typeof createTestUser>;

// Same tenant, different team claim.
const userA: TestUser = createTestUser({
  id: 60,
  roles: ["TenantMember"],
  claims: { team: "team-a" },
});
const userB: TestUser = createTestUser({
  id: 61,
  roles: ["TenantMember"],
  claims: { team: "team-b" },
});

const PROJECT_A = "b0000000-0000-4000-8000-000000000001";
// A second team-a project, dedicated to the remove-tag denial case so its
// assignment count stays independent of PROJECT_A's.
const PROJECT_A2 = "b0000000-0000-4000-8000-000000000002";
// Never assigned anything — the "no assignment" half of the oracle check.
const PROJECT_A3 = "b0000000-0000-4000-8000-000000000003";
const PROJECT_B = "b0000000-0000-4000-8000-000000000011";
const PROJECT_B_GONE = "b0000000-0000-4000-8000-000000000012";
const PROJECT_A_DEL = "b0000000-0000-4000-8000-000000000013";

let stack: TestStack;
let tagId: string;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createTagsFeature({ parents: ["project"],
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      }),
      hostFixturesFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, tagEntity);
  await unsafeCreateEntityTable(stack.db, tagAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, projectEntity);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id, name) VALUES
       ($1, $2, 'team-a', 'Project A'),
       ($3, $2, 'team-a', 'Project A2'),
       ($4, $2, 'team-a', 'Project A3'),
       ($5, $2, 'team-b', 'Project B'),
       ($6, $2, 'team-b', 'Project B gone'),
       ($7, $2, 'team-a', 'Project A del')`,
    [PROJECT_A, userA.tenantId, PROJECT_A2, PROJECT_A3, PROJECT_B, PROJECT_B_GONE, PROJECT_A_DEL],
  );

  const tag = await stack.http.writeOk<{ id: string }>(
    TagsHandlers.createTag,
    { name: "VIP" },
    userA,
  );
  tagId = tag.id;
});

afterAll(async () => {
  await stack.cleanup();
});

async function activeAssignmentsFor(entityId: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe<{ n: number }>(
    "SELECT count(*)::int AS n FROM read_tag_assignments WHERE entity_id = $1 AND is_deleted = FALSE",
    [entityId],
  );
  return rows[0]?.n ?? 0;
}

async function createTagAs(name: string, user: TestUser): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(TagsHandlers.createTag, { name }, user);
  return created.id;
}

function assignTagTo(tag: string, entityId: string, user: TestUser) {
  return stack.http.writeOk<{ id: string }>(
    TagsHandlers.assignTag,
    { tagId: tag, entityType: "project", entityId },
    user,
  );
}

async function activeAssignmentsOfTag(tag: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe<{ n: number }>(
    "SELECT count(*)::int AS n FROM read_tag_assignments WHERE tag_id = $1 AND is_deleted = FALSE",
    [tag],
  );
  return rows[0]?.n ?? 0;
}

async function tagExists(tag: string): Promise<boolean> {
  const rows = await asRawClient(stack.db).unsafe<{ n: number }>(
    "SELECT count(*)::int AS n FROM read_tags WHERE id = $1",
    [tag],
  );
  return (rows[0]?.n ?? 0) > 0;
}

function reasonOf(err: { details?: unknown }): unknown {
  return isPlainObject(err.details) ? err.details["reason"] : undefined;
}

function assign(entityType: string, entityId: string, user: TestUser) {
  return stack.http.writeOk<{ id: string }>(
    TagsHandlers.assignTag,
    { tagId, entityType, entityId },
    user,
  );
}

function assignErr(entityType: string, entityId: string, user: TestUser) {
  return stack.http.writeErr(TagsHandlers.assignTag, { tagId, entityType, entityId }, user);
}

function remove(entityType: string, entityId: string, user: TestUser) {
  return stack.http.writeOk<{ id: string }>(
    TagsHandlers.removeTag,
    { tagId, entityType, entityId },
    user,
  );
}

function removeErr(entityType: string, entityId: string, user: TestUser) {
  return stack.http.writeErr(TagsHandlers.removeTag, { tagId, entityType, entityId }, user);
}

describe("tags integration — assign-tag parent-visibility", () => {
  test("a host row visible through the host entity's own read path can be tagged", async () => {
    const result = await assign("project", PROJECT_A, userA);
    expect(result.id).toBeTruthy();
    expect(await activeAssignmentsFor(PROJECT_A)).toBe(1);
  });

  test("a host row from a foreign team is denied, and nothing is written", async () => {
    const err = await assignErr("project", PROJECT_A2, userB);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(0);

    // Positive control: PROJECT_A2 IS taggable — by its own team — so the deny
    // above is the team-claim check, not a row that doesn't exist at all.
    const result = await assign("project", PROJECT_A2, userA);
    expect(result.id).toBeTruthy();
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(1);
  });

  test("an entityType that is not a registered entity is denied", async () => {
    const err = await assignErr("totally-unknown-entity", PROJECT_A, userA);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
  });

  test("a malformed entityId is denied cleanly, without poisoning the connection", async () => {
    const err = await assignErr("project", "not-a-uuid", userA);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);

    // The stack must still be usable — proves the malformed id was rejected
    // before it reached a query, not caught after a tx-poisoning cast error.
    expect((await assign("project", PROJECT_A, userA)).id).toBeTruthy();
  });
});

describe("tags integration — remove-tag parent-visibility", () => {
  test("a foreign team cannot detach an existing assignment; the row survives", async () => {
    await assign("project", PROJECT_A2, userA);
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(1);

    const err = await removeErr("project", PROJECT_A2, userB);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
    // Zero-write: the assignment userA made is still active, not soft-deleted.
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(1);

    // Positive control: the owning team CAN detach it.
    await remove("project", PROJECT_A2, userA);
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(0);
  });

  test("the denial carries no existence oracle: assigned and unassigned rows answer alike", async () => {
    await assign("project", PROJECT_A2, userA);
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(1);
    expect(await activeAssignmentsFor(PROJECT_A3)).toBe(0);

    // remove-tag normally reports success for a never-assigned pair, so without
    // the gate running FIRST the two responses below would differ and leak
    // whether the invisible host row carries this tag.
    const onAssigned = await removeErr("project", PROJECT_A2, userB);
    const onUnassigned = await removeErr("project", PROJECT_A3, userB);
    expect(onAssigned.code).toBe(onUnassigned.code);
    expect(onAssigned.httpStatus).toBe(onUnassigned.httpStatus);
    expect(onAssigned.code).toBe("not_found");

    await remove("project", PROJECT_A2, userA);
  });

  test("an entityType that is not a registered entity is denied", async () => {
    const err = await removeErr("totally-unknown-entity", PROJECT_A, userA);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
  });
});

describe("tags integration — tag:delete never detaches a tag from records the caller cannot see", () => {
  test("a member cannot delete a tag that a record of another team carries; nothing is detached", async () => {
    const tag = await createTagAs("Shared", userA);
    await assignTagTo(tag, PROJECT_A_DEL, userA);
    await assignTagTo(tag, PROJECT_B, userB);

    const err = await stack.http.writeErr(TagsHandlers.deleteTag, { id: tag }, userA);
    expect(err.httpStatus).toBe(422);
    expect(reasonOf(err)).toBe("tag_in_use_on_hidden_records");
    expect(await activeAssignmentsOfTag(tag)).toBe(2);
    expect(await tagExists(tag)).toBe(true);

    const errB = await stack.http.writeErr(TagsHandlers.deleteTag, { id: tag }, userB);
    expect(errB.httpStatus).toBe(422);
    expect(await activeAssignmentsOfTag(tag)).toBe(2);
  });

  test("once only visible records carry the tag, the member deletes it with the cascade", async () => {
    const tag = await createTagAs("Team B only", userB);
    await assignTagTo(tag, PROJECT_B, userB);

    await stack.http.writeOk(TagsHandlers.deleteTag, { id: tag }, userB);
    expect(await activeAssignmentsOfTag(tag)).toBe(0);
    expect(await tagExists(tag)).toBe(false);
  });

  test("an assignment on a deleted record of another team does not block the delete and is removed", async () => {
    const tag = await createTagAs("Orphan", userA);
    await assignTagTo(tag, PROJECT_A_DEL, userA);
    await assignTagTo(tag, PROJECT_B_GONE, userB);
    await asRawClient(stack.db).unsafe(`DELETE FROM ${PROJECT_TABLE} WHERE id = $1`, [
      PROJECT_B_GONE,
    ]);

    await stack.http.writeOk(TagsHandlers.deleteTag, { id: tag }, userA);
    expect(await activeAssignmentsOfTag(tag)).toBe(0);
    expect(await tagExists(tag)).toBe(false);
  });
});
