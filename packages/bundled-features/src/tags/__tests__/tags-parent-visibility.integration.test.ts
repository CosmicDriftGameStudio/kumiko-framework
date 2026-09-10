// assign-tag/remove-tag previously took entityType/entityId straight from the
// client, so any dispatch-eligible tenant user could attach a catalog tag to —
// or detach one from — an object they had no read access to. The tag-assignment
// aggregate-id is derived from the tenant, so this was never a cross-tenant
// hole; it was "tag an object inside your own tenant that you aren't allowed to
// read", which also leaks through the assignment list of anyone who can see it.
//
// The check is unconditional (default-on, no opt-in): entityType must name a
// registered entity, and the host row must be visible through that entity's own
// read path (tenant scope plus its `access.read` ownership).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { TagsHandlers } from "../constants";
import { tagAssignmentEntity, tagEntity } from "../entity";
import { createTagsFeature } from "../feature";

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
    teamId: createTextField({ required: true, maxLength: 64 }),
    name: createTextField({ required: true, maxLength: 64 }),
  },
  access: projectOwnership,
});

const hostFixturesFeature = defineFeature("tags-pv-test-fixtures", (r) => {
  r.entity("project", projectEntity);
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

let stack: TestStack;
let tagId: string;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createTagsFeature({ access: { openToAll: true } }), hostFixturesFeature],
  });
  await unsafeCreateEntityTable(stack.db, tagEntity);
  await unsafeCreateEntityTable(stack.db, tagAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, projectEntity);
  await createEventsTable(stack.db);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id, name) VALUES
       ($1, $2, 'team-a', 'Project A'),
       ($3, $2, 'team-a', 'Project A2'),
       ($4, $2, 'team-a', 'Project A3')`,
    [PROJECT_A, userA.tenantId, PROJECT_A2, PROJECT_A3],
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
