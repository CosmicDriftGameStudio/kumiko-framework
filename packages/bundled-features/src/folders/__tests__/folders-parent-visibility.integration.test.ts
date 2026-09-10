// set-folder/clear-folder previously took entityType/entityId straight from the
// client, so any dispatch-eligible tenant user could file — or unfile — an
// object they had no read access to. The folder-assignment aggregate-id is
// derived from the tenant, so this was never a cross-tenant hole; it was "file
// an object inside your own tenant that you aren't allowed to read", which also
// moves it out of whatever folder its own team had put it in.
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
import { FoldersHandlers } from "../constants";
import { folderAssignmentEntity, folderEntity } from "../entity";
import { createFoldersFeature } from "../feature";

const PROJECT_TABLE = "folders_pv_test_projects";

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

const hostFixturesFeature = defineFeature("folders-pv-test-fixtures", (r) => {
  r.entity("project", projectEntity);
});

type TestUser = ReturnType<typeof createTestUser>;

// Same tenant, different team claim.
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

const PROJECT_A = "c0000000-0000-4000-8000-000000000001";
// A second team-a project, dedicated to the clear-folder denial case so its
// membership stays independent of PROJECT_A's.
const PROJECT_A2 = "c0000000-0000-4000-8000-000000000002";
// Never filed anywhere — the "no assignment" half of the oracle check.
const PROJECT_A3 = "c0000000-0000-4000-8000-000000000003";

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
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id, name) VALUES
       ($1, $2, 'team-a', 'Project A'),
       ($3, $2, 'team-a', 'Project A2'),
       ($4, $2, 'team-a', 'Project A3')`,
    [PROJECT_A, userA.tenantId, PROJECT_A2, PROJECT_A3],
  );

  const folder = await stack.http.writeOk<{ id: string }>(
    FoldersHandlers.createFolder,
    { name: "Inbox" },
    userA,
  );
  folderId = folder.id;
});

afterAll(async () => {
  await stack.cleanup();
});

async function activeAssignmentsFor(entityId: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe<{ n: number }>(
    "SELECT count(*)::int AS n FROM read_folder_assignments WHERE entity_id = $1 AND is_deleted = FALSE",
    [entityId],
  );
  return rows[0]?.n ?? 0;
}

function setFolder(entityType: string, entityId: string, user: TestUser) {
  return stack.http.writeOk<{ id: string }>(
    FoldersHandlers.setFolder,
    { folderId, entityType, entityId },
    user,
  );
}

function setFolderErr(entityType: string, entityId: string, user: TestUser) {
  return stack.http.writeErr(FoldersHandlers.setFolder, { folderId, entityType, entityId }, user);
}

function clearFolder(entityType: string, entityId: string, user: TestUser) {
  return stack.http.writeOk<{ id: string }>(
    FoldersHandlers.clearFolder,
    { entityType, entityId },
    user,
  );
}

function clearFolderErr(entityType: string, entityId: string, user: TestUser) {
  return stack.http.writeErr(FoldersHandlers.clearFolder, { entityType, entityId }, user);
}

describe("folders integration — set-folder parent-visibility", () => {
  test("a host row visible through the host entity's own read path can be filed", async () => {
    const result = await setFolder("project", PROJECT_A, userA);
    expect(result.id).toBeTruthy();
    expect(await activeAssignmentsFor(PROJECT_A)).toBe(1);
  });

  test("a host row from a foreign team is denied, and nothing is written", async () => {
    const err = await setFolderErr("project", PROJECT_A2, userB);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(0);

    // Positive control: PROJECT_A2 IS filable — by its own team — so the deny
    // above is the team-claim check, not a row that doesn't exist at all.
    const result = await setFolder("project", PROJECT_A2, userA);
    expect(result.id).toBeTruthy();
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(1);
  });

  test("the denial precedes the folder lookup: an unknown folderId reports the host row, not the folder", async () => {
    // Gate first means a caller who can't see the host row learns nothing about
    // which folder ids exist — both cases answer with the same not_found.
    const unknownFolder = await stack.http.writeErr(
      FoldersHandlers.setFolder,
      {
        folderId: "00000000-0000-4000-8000-00000000dead",
        entityType: "project",
        entityId: PROJECT_A3,
      },
      userB,
    );
    const knownFolder = await setFolderErr("project", PROJECT_A3, userB);
    expect(unknownFolder.code).toBe(knownFolder.code);
    expect(unknownFolder.httpStatus).toBe(knownFolder.httpStatus);
    expect(knownFolder.code).toBe("not_found");
    expect(await activeAssignmentsFor(PROJECT_A3)).toBe(0);
  });

  test("an entityType that is not a registered entity is denied", async () => {
    const err = await setFolderErr("totally-unknown-entity", PROJECT_A, userA);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
  });

  test("a malformed entityId is denied cleanly, without poisoning the connection", async () => {
    const err = await setFolderErr("project", "not-a-uuid", userA);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);

    // The stack must still be usable — proves the malformed id was rejected
    // before it reached a query, not caught after a tx-poisoning cast error.
    expect((await setFolder("project", PROJECT_A, userA)).id).toBeTruthy();
  });
});

describe("folders integration — clear-folder parent-visibility", () => {
  test("a foreign team cannot unfile an existing membership; the row survives", async () => {
    await setFolder("project", PROJECT_A2, userA);
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(1);

    const err = await clearFolderErr("project", PROJECT_A2, userB);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
    // Zero-write: the membership userA created is still active, not soft-deleted.
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(1);

    // Positive control: the owning team CAN unfile it.
    await clearFolder("project", PROJECT_A2, userA);
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(0);
  });

  test("the denial carries no existence oracle: filed and unfiled rows answer alike", async () => {
    await setFolder("project", PROJECT_A2, userA);
    expect(await activeAssignmentsFor(PROJECT_A2)).toBe(1);
    expect(await activeAssignmentsFor(PROJECT_A3)).toBe(0);

    // clear-folder normally reports success for a never-filed entity, so without
    // the gate running FIRST the two responses below would differ and leak
    // whether the invisible host row sits in a folder at all.
    const onFiled = await clearFolderErr("project", PROJECT_A2, userB);
    const onUnfiled = await clearFolderErr("project", PROJECT_A3, userB);
    expect(onFiled.code).toBe(onUnfiled.code);
    expect(onFiled.httpStatus).toBe(onUnfiled.httpStatus);
    expect(onFiled.code).toBe("not_found");

    await clearFolder("project", PROJECT_A2, userA);
  });

  test("an entityType that is not a registered entity is denied", async () => {
    const err = await clearFolderErr("totally-unknown-entity", PROJECT_A, userA);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
  });
});
