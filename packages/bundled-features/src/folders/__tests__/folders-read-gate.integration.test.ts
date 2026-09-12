// The read twin of folders-parent-visibility.integration.test.ts (fw#2766).
// set-folder/clear-folder were gated against the host row's own read path, but
// `folder-assignment:list` returned every membership row of the tenant — and
// unlike tags/notes, folders had no `ownership` option at all, so there was no
// opt-in lever either. The gate below is default-on.

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
import { FoldersHandlers, FoldersQueries } from "../constants";
import { folderAssignmentEntity, folderEntity } from "../entity";
import { createFoldersFeature } from "../feature";

const PROJECT_TABLE = "folders_rg_test_projects";

const teamScopedRead: NonNullable<EntityDefinition["access"]> = {
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
  },
  access: teamScopedRead,
});

const hostFixturesFeature = defineFeature("folders-rg-test-fixtures", (r) => {
  r.entity("project", projectEntity);
});

type TestUser = ReturnType<typeof createTestUser>;

const userA: TestUser = createTestUser({
  id: 90,
  roles: ["TenantMember"],
  claims: { team: "team-a" },
});
const userB: TestUser = createTestUser({
  id: 91,
  roles: ["TenantMember"],
  claims: { team: "team-b" },
});

const PROJECT_A = "e0000000-0000-4000-8000-00000000000a";
const PROJECT_B = "e0000000-0000-4000-8000-00000000000b";
const ORPHAN_HOST_ID = "e0000000-0000-4000-8000-0000000000ff";

type AssignmentRow = { id: string; folderId: string; entityType: string; entityId: string };
type Page = { rows: readonly AssignmentRow[]; nextCursor: string | null; total?: number };

let stack: TestStack;
let folderId: string;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createFoldersFeature({ access: { openToAll: true } }), hostFixturesFeature],
  });
  await unsafeCreateEntityTable(stack.db, folderEntity);
  await unsafeCreateEntityTable(stack.db, folderAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, projectEntity);
  await createEventsTable(stack.db);

  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id) VALUES ($1, $3, 'team-a'), ($2, $3, 'team-b')`,
    [PROJECT_A, PROJECT_B, userA.tenantId],
  );

  const folder = await stack.http.writeOk<{ id: string }>(
    FoldersHandlers.createFolder,
    { name: "Shared" },
    userA,
  );
  folderId = folder.id;

  await stack.http.writeOk(
    FoldersHandlers.setFolder,
    { folderId, entityType: "project", entityId: PROJECT_A },
    userA,
  );
  await stack.http.writeOk(
    FoldersHandlers.setFolder,
    { folderId, entityType: "project", entityId: PROJECT_B },
    userB,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

function listAssignments(payload: Record<string, unknown>, user: TestUser): Promise<Page> {
  return stack.http.queryOk<Page>(FoldersQueries.assignmentList, payload, user);
}

describe("folders read-gate", () => {
  test("the owning team sees which folder its own project sits in", async () => {
    const page = await listAssignments(
      { filter: { field: "entityId", op: "eq", value: PROJECT_A } },
      userA,
    );
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.entityId).toBe(PROJECT_A);
  });

  test("a foreign team sees nothing there — folders never had an ownership opt-in", async () => {
    const page = await listAssignments(
      { filter: { field: "entityId", op: "eq", value: PROJECT_A }, totalCount: true },
      userB,
    );
    expect(page.rows).toHaveLength(0);
    expect(page.total).toBe(0);
  });

  test("listing a folder's contents shows only hosts the caller can read", async () => {
    const forA = await listAssignments(
      { filter: { field: "folderId", op: "eq", value: folderId }, totalCount: true },
      userA,
    );
    expect(forA.rows.map((r) => r.entityId)).toEqual([PROJECT_A]);
    expect(forA.total).toBe(1);

    const forB = await listAssignments(
      { filter: { field: "folderId", op: "eq", value: folderId }, totalCount: true },
      userB,
    );
    expect(forB.rows.map((r) => r.entityId)).toEqual([PROJECT_B]);
    expect(forB.total).toBe(1);
  });

  test("an assignment whose entityType names no registered entity is invisible to everyone", async () => {
    const orphanId = "e0000000-0000-4000-8000-0000000000f1";
    await asRawClient(stack.db).unsafe(
      `INSERT INTO read_folder_assignments (id, tenant_id, folder_id, entity_type, entity_id, is_deleted)
       VALUES ($1, $2, $3, 'not-a-registered-entity', $4, FALSE)`,
      [orphanId, userA.tenantId, folderId, ORPHAN_HOST_ID],
    );

    for (const user of [userA, userB]) {
      const page = await listAssignments(
        { filter: { field: "entityId", op: "eq", value: ORPHAN_HOST_ID }, totalCount: true },
        user,
      );
      expect(page.rows).toHaveLength(0);
      expect(page.total).toBe(0);
    }

    const raw = await asRawClient(stack.db).unsafe<{ n: number }>(
      "SELECT count(*)::int AS n FROM read_folder_assignments WHERE id = $1",
      [orphanId],
    );
    expect(raw[0]?.n).toBe(1);
  });
});
