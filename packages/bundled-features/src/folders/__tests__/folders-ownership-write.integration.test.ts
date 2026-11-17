// ownership.write on folder-assignment must gate set-folder (create, move, restore) and
// clear-folder, not only the framework's generic paths. The rule below lets a user write only
// assignments whose host entityId is their own user id.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
  from,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { folderAssignmentEntity, folderEntity } from "../entity.ts";
import { createFoldersFeature } from "../feature.ts";
import { FoldersHandlers, FoldersQueries } from "../web/constants.ts";

const projectEntity = createEntity({
  name: "project",
  table: "folders_ow_test_projects",
  fields: {
    name: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

const { executor: projectExecutor } = createEntityExecutor(projectEntity);

const hostFixturesFeature = defineFeature("folders-ow-test-fixtures", (r) => {
  r.entity(projectEntity);
  r.writeHandler({
    name: "project:seed",
    schema: z.object({ id: z.uuid(), name: z.string() }),
    access: { openToAll: { reason: "test fixture seeds host rows" } },
    handler: async (event, ctx) => projectExecutor.create(event.payload, event.user, ctx.db),
  });
});

const owner = createTestUser({ id: 80, roles: ["TenantMember"] });
const stranger = createTestUser({ id: 81, roles: ["TenantMember"] });

let stack: TestStack;
let folderId: string;

type AssignmentRow = { entityId: string };

async function assignmentCount(): Promise<number> {
  const page = await stack.http.queryOk<{ rows: readonly AssignmentRow[] }>(
    FoldersQueries.assignmentList,
    { limit: 50 },
    owner,
  );
  return page.rows.filter((row) => row.entityId === owner.id).length;
}

const assignment = () => ({ folderId, entityType: "project", entityId: owner.id });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createFoldersFeature({
        parents: ["project"],
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        ownership: { write: { TenantMember: from("user:id", "entityId") } },
      }),
      hostFixturesFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, folderEntity);
  await unsafeCreateEntityTable(stack.db, folderAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, projectEntity);
  await stack.http.writeOk(
    "folders-ow-test-fixtures:write:project:seed",
    { id: owner.id, name: "own" },
    owner,
  );
  const folder = await stack.http.writeOk<{ id: string }>(
    FoldersHandlers.createFolder,
    { name: "Owned" },
    owner,
  );
  folderId = folder.id;
});

afterAll(async () => {
  await stack.cleanup();
});

// clear-folder is idempotent, so every test starts without an assignment.
beforeEach(async () => {
  await stack.http.writeOk(FoldersHandlers.clearFolder, assignment(), owner);
});

describe("folders — ownership.write gates set-folder and clear-folder", () => {
  test("a caller outside the write rule cannot create an assignment", async () => {
    const err = await stack.http.writeErr(FoldersHandlers.setFolder, assignment(), stranger);
    expectErrorIncludes(err, "ownership_denied");
    expect(await assignmentCount()).toBe(0);
  });

  test("a caller inside the write rule can file and unfile", async () => {
    await stack.http.writeOk(FoldersHandlers.setFolder, assignment(), owner);
    expect(await assignmentCount()).toBe(1);

    await stack.http.writeOk(FoldersHandlers.clearFolder, assignment(), owner);
    expect(await assignmentCount()).toBe(0);
  });

  test("a caller outside the write rule cannot unfile an assignment", async () => {
    await stack.http.writeOk(FoldersHandlers.setFolder, assignment(), owner);

    const err = await stack.http.writeErr(FoldersHandlers.clearFolder, assignment(), stranger);
    expectErrorIncludes(err, "ownership_denied");
    expect(await assignmentCount()).toBe(1);
  });

  test("a caller outside the write rule cannot restore an unfiled assignment", async () => {
    await stack.http.writeOk(FoldersHandlers.setFolder, assignment(), owner);
    await stack.http.writeOk(FoldersHandlers.clearFolder, assignment(), owner);
    expect(await assignmentCount()).toBe(0);

    const err = await stack.http.writeErr(FoldersHandlers.setFolder, assignment(), stranger);
    expectErrorIncludes(err, "ownership_denied");
    expect(await assignmentCount()).toBe(0);
  });
});
