// The read twin of tags-parent-visibility.integration.test.ts (fw#2766).
// assign/remove were gated against the host row's own read path since
// #2721/#2745, but `tag-assignment:list` returned every row of the tenant —
// including assignments on host rows the caller could never see. Closing that
// is default-on: none of the mounts below set `ownership`, which used to be
// the only lever.

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
import { TagsHandlers, TagsQueries } from "../constants";
import { tagAssignmentEntity, tagEntity } from "../entity";
import { createTagsFeature } from "../feature";

const PROJECT_TABLE = "tags_rg_test_projects";

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

const hostFixturesFeature = defineFeature("tags-rg-test-fixtures", (r) => {
  r.entity("project", projectEntity);
});

type TestUser = ReturnType<typeof createTestUser>;

const userA: TestUser = createTestUser({
  id: 70,
  roles: ["TenantMember"],
  claims: { team: "team-a" },
});
const userB: TestUser = createTestUser({
  id: 71,
  roles: ["TenantMember"],
  claims: { team: "team-b" },
});

// 4 projects for team-a, 3 for team-b — every one of them carries the same
// tag, so the tagId scatter query below has a mixed-visibility result set.
const TEAM_A_PROJECTS = [
  "c0000000-0000-4000-8000-00000000000a",
  "c0000000-0000-4000-8000-00000000000b",
  "c0000000-0000-4000-8000-00000000000c",
  "c0000000-0000-4000-8000-00000000000d",
];
const TEAM_B_PROJECTS = [
  "c0000000-0000-4000-8000-00000000001a",
  "c0000000-0000-4000-8000-00000000001b",
  "c0000000-0000-4000-8000-00000000001c",
];
// Referenced by an assignment row but registered under no entity name.
const ORPHAN_HOST_ID = "c0000000-0000-4000-8000-0000000000ff";

type AssignmentRow = { id: string; tagId: string; entityType: string; entityId: string };
type Page = { rows: readonly AssignmentRow[]; nextCursor: string | null; total?: number };

let stack: TestStack;
let tagId: string;

beforeAll(async () => {
  stack = await setupTestStack({
    // Deliberately no `ownership` — the gate must hold on a bare mount.
    features: [createTagsFeature({ access: { openToAll: true } }), hostFixturesFeature],
  });
  await unsafeCreateEntityTable(stack.db, tagEntity);
  await unsafeCreateEntityTable(stack.db, tagAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, projectEntity);
  await createEventsTable(stack.db);

  const values = [...TEAM_A_PROJECTS, ...TEAM_B_PROJECTS]
    .map((id, i) => `('${id}', $1, '${i < TEAM_A_PROJECTS.length ? "team-a" : "team-b"}', 'p${i}')`)
    .join(", ");
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id, name) VALUES ${values}`,
    [userA.tenantId],
  );

  const tag = await stack.http.writeOk<{ id: string }>(
    TagsHandlers.createTag,
    { name: "VIP" },
    userA,
  );
  tagId = tag.id;

  for (const id of TEAM_A_PROJECTS) {
    await stack.http.writeOk(
      TagsHandlers.assignTag,
      { tagId, entityType: "project", entityId: id },
      userA,
    );
  }
  for (const id of TEAM_B_PROJECTS) {
    await stack.http.writeOk(
      TagsHandlers.assignTag,
      { tagId, entityType: "project", entityId: id },
      userB,
    );
  }
});

afterAll(async () => {
  await stack.cleanup();
});

function listAssignments(payload: Record<string, unknown>, user: TestUser): Promise<Page> {
  return stack.http.queryOk<Page>(TagsQueries.assignmentList, payload, user);
}

describe("tags read-gate — entityId-filtered list", () => {
  test("the owning team sees the assignment on its own project", async () => {
    const page = await listAssignments(
      { filter: { field: "entityId", op: "eq", value: TEAM_A_PROJECTS[0] } },
      userA,
    );
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.entityId).toBe(TEAM_A_PROJECTS[0] as string);
  });

  test("a foreign team sees nothing on that same project, without setting ownership", async () => {
    const page = await listAssignments(
      { filter: { field: "entityId", op: "eq", value: TEAM_A_PROJECTS[0] } },
      userB,
    );
    expect(page.rows).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });
});

describe("tags read-gate — unregistered host type", () => {
  test("an assignment whose entityType names no registered entity is invisible to everyone", async () => {
    const orphanId = "c0000000-0000-4000-8000-0000000000f1";
    await asRawClient(stack.db).unsafe(
      `INSERT INTO read_tag_assignments (id, tenant_id, tag_id, entity_type, entity_id, is_deleted)
       VALUES ($1, $2, $3, 'not-a-registered-entity', $4, FALSE)`,
      [orphanId, userA.tenantId, tagId, ORPHAN_HOST_ID],
    );

    for (const user of [userA, userB]) {
      const page = await listAssignments(
        { filter: { field: "entityId", op: "eq", value: ORPHAN_HOST_ID }, totalCount: true },
        user,
      );
      expect(page.rows).toHaveLength(0);
      expect(page.total).toBe(0);
    }

    // Positive control: the row really is in the table, so the zero above is
    // the gate and not a failed insert.
    const raw = await asRawClient(stack.db).unsafe<{ n: number }>(
      "SELECT count(*)::int AS n FROM read_tag_assignments WHERE id = $1",
      [orphanId],
    );
    expect(raw[0]?.n).toBe(1);
  });
});

describe("tags read-gate — tagId scatter query stays paginated honestly", () => {
  async function drain(user: TestUser, limit: number): Promise<readonly AssignmentRow[]> {
    const seen: AssignmentRow[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page: Page = await listAssignments(
        {
          filter: { field: "tagId", op: "eq", value: tagId },
          limit,
          ...(cursor !== null && { cursor }),
        },
        user,
      );
      seen.push(...page.rows);
      if (page.nextCursor === null) {
        // A short page must be the last one.
        expect(page.rows.length).toBeLessThanOrEqual(limit);
        return seen;
      }
      // Every non-final page is full — a post-filter would shrink it here.
      expect(page.rows).toHaveLength(limit);
      cursor = page.nextCursor;
    }
    throw new Error("pagination did not terminate");
  }

  test("total counts only the rows the caller may see", async () => {
    const forB = await listAssignments(
      { filter: { field: "tagId", op: "eq", value: tagId }, totalCount: true },
      userB,
    );
    expect(forB.total).toBe(TEAM_B_PROJECTS.length);

    const forA = await listAssignments(
      { filter: { field: "tagId", op: "eq", value: tagId }, totalCount: true },
      userA,
    );
    expect(forA.total).toBe(TEAM_A_PROJECTS.length);
  });

  test("paging through the scatter query yields exactly the visible set, once each", async () => {
    const drained = await drain(userA, 2);
    const ids = drained.map((r) => r.entityId).sort();
    expect(ids).toEqual([...TEAM_A_PROJECTS].sort());
    expect(new Set(drained.map((r) => r.id)).size).toBe(drained.length);

    const { total } = await listAssignments(
      { filter: { field: "tagId", op: "eq", value: tagId }, totalCount: true },
      userA,
    );
    expect(drained).toHaveLength(total as number);
  });

  test("every row handed out belongs to a host the caller can actually read", async () => {
    const drained = await drain(userB, 2);
    expect(drained.length).toBeGreaterThan(0);
    for (const row of drained) {
      expect(TEAM_B_PROJECTS).toContain(row.entityId);
    }
  });
});

describe("tags read-gate — ownership narrows further, it does not replace the gate", () => {
  const OWNED_TABLE = "tags_rg_owned_projects";
  const ownedEntity = createEntity({
    table: OWNED_TABLE,
    fields: {
      teamId: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
    },
    access: {
      read: {
        TenantMember: {
          kind: "where",
          where: (user, ctx) => ({
            sqlText: `${ctx.tableName}.team_id = $${ctx.paramStart}`,
            params: [user.claims?.["team"] ?? null],
          }),
        },
      },
    },
  });
  const ownedFixtures = defineFeature("tags-rg-owned-fixtures", (r) => {
    r.entity("project", ownedEntity);
  });
  const HOST = "c0000000-0000-4000-8000-00000000002a";
  // Same team (so the host gate passes for both), but only `tagger` carries
  // the hostKind claim the extra assignment-row rule demands.
  const tagger: TestUser = createTestUser({
    id: 73,
    roles: ["TenantMember"],
    claims: { team: "team-a", hostKind: "project" },
  });
  const peer: TestUser = createTestUser({
    id: 74,
    roles: ["TenantMember"],
    claims: { team: "team-a", hostKind: "something-else" },
  });

  let ownedStack: TestStack;
  let ownedTagId: string;

  beforeAll(async () => {
    ownedStack = await setupTestStack({
      features: [
        createTagsFeature({
          access: { openToAll: true },
          // An extra row rule on the assignment row itself, unrelated to who
          // may see the host: the caller's claim must name the row's host type.
          ownership: {
            read: {
              TenantMember: {
                kind: "where",
                where: (user, ctx) => ({
                  sqlText: `${ctx.tableName}.entity_type = $${ctx.paramStart}`,
                  params: [user.claims?.["hostKind"] ?? null],
                }),
              },
            },
          },
        }),
        ownedFixtures,
      ],
    });
    await unsafeCreateEntityTable(ownedStack.db, tagEntity);
    await unsafeCreateEntityTable(ownedStack.db, tagAssignmentEntity);
    await unsafeCreateEntityTable(ownedStack.db, ownedEntity);
    await createEventsTable(ownedStack.db);
    await asRawClient(ownedStack.db).unsafe(
      `INSERT INTO ${OWNED_TABLE} (id, tenant_id, team_id) VALUES ($1, $2, 'team-a')`,
      [HOST, tagger.tenantId],
    );
    const tag = await ownedStack.http.writeOk<{ id: string }>(
      TagsHandlers.createTag,
      { name: "Owned" },
      tagger,
    );
    ownedTagId = tag.id;
    await ownedStack.http.writeOk(
      TagsHandlers.assignTag,
      { tagId: ownedTagId, entityType: "project", entityId: HOST },
      tagger,
    );
  });

  afterAll(async () => {
    await ownedStack.cleanup();
  });

  test("a caller passing both the host gate and the extra row rule still sees the row", async () => {
    const page = await ownedStack.http.queryOk<Page>(
      TagsQueries.assignmentList,
      { filter: { field: "entityId", op: "eq", value: HOST } },
      tagger,
    );
    expect(page.rows).toHaveLength(1);
  });

  test("a same-team peer is cut by ownership even though the host is visible to them", async () => {
    const page = await ownedStack.http.queryOk<Page>(
      TagsQueries.assignmentList,
      { filter: { field: "entityId", op: "eq", value: HOST } },
      peer,
    );
    expect(page.rows).toHaveLength(0);
  });
});
