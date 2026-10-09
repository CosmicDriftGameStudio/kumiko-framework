// folder:delete used to refuse forever while an assignment pointed at a host
// that was deleted: clear-folder needs a visible host, so nothing could remove
// the assignment. Assignments of gone hosts are now cleaned up by folder:delete
// itself; assignments of live hosts keep blocking.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { FoldersHandlers } from "../constants.js";
import { folderAssignmentEntity, folderEntity } from "../entity.js";
import { createFoldersFeature } from "../feature.js";

const DOC_TABLE = "folders_orphan_test_docs";

const teamOwnership: NonNullable<EntityDefinition["access"]> = {
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

const docEntity = createEntity({
  table: DOC_TABLE,
  softDelete: true,
  fields: {
    teamId: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
  access: teamOwnership,
});

const hostFixturesFeature = defineFeature("folders-orphan-test-fixtures", (r) => {
  r.entity("doc", docEntity);
});

const userA = createTestUser({ id: 80, roles: ["TenantMember"], claims: { team: "team-a" } });
const userB = createTestUser({ id: 81, roles: ["TenantMember"], claims: { team: "team-b" } });

let stack: TestStack;
let docCounter = 0;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createFoldersFeature({
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      }),
      hostFixturesFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, folderEntity);
  await unsafeCreateEntityTable(stack.db, folderAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, docEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function createDocIn(folderId: string, team: string): Promise<string> {
  docCounter += 1;
  const docId = `d0000000-0000-4000-8000-${String(docCounter).padStart(12, "0")}`;
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${DOC_TABLE} (id, tenant_id, team_id) VALUES ($1, $2, $3)`,
    [docId, userA.tenantId, team],
  );
  const owner = team === "team-a" ? userA : userB;
  await stack.http.writeOk(
    FoldersHandlers.setFolder,
    { folderId, entityType: "doc", entityId: docId },
    owner,
  );
  return docId;
}

async function createFolder(): Promise<string> {
  const folder = await stack.http.writeOk<{ id: string }>(
    FoldersHandlers.createFolder,
    { name: "Inbox" },
    userA,
  );
  return folder.id;
}

function reasonOf(err: { details?: unknown }): string | undefined {
  return (err.details as { reason?: string } | undefined)?.reason;
}

async function activeAssignmentsIn(folderId: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe<{ n: number }>(
    "SELECT count(*)::int AS n FROM read_folder_assignments WHERE folder_id = $1 AND is_deleted = FALSE",
    [folderId],
  );
  return rows[0]?.n ?? 0;
}

describe("folders integration — folder:delete with assignments of deleted hosts", () => {
  test("a soft-deleted host no longer blocks folder:delete and its assignment is removed", async () => {
    const folderId = await createFolder();
    const docId = await createDocIn(folderId, "team-a");
    await asRawClient(stack.db).unsafe(`UPDATE ${DOC_TABLE} SET is_deleted = TRUE WHERE id = $1`, [
      docId,
    ]);

    await stack.http.writeOk(FoldersHandlers.deleteFolder, { id: folderId }, userA);
    expect(await activeAssignmentsIn(folderId)).toBe(0);
  });

  test("a hard-deleted host no longer blocks folder:delete", async () => {
    const folderId = await createFolder();
    const docId = await createDocIn(folderId, "team-a");
    await asRawClient(stack.db).unsafe(`DELETE FROM ${DOC_TABLE} WHERE id = $1`, [docId]);

    await stack.http.writeOk(FoldersHandlers.deleteFolder, { id: folderId }, userA);
    expect(await activeAssignmentsIn(folderId)).toBe(0);
  });

  test("an active host blocks folder:delete, even one the caller cannot see", async () => {
    const folderId = await createFolder();
    await createDocIn(folderId, "team-b");

    const err = await stack.http.writeErr(FoldersHandlers.deleteFolder, { id: folderId }, userA);
    expect(reasonOf(err)).toBe("folder_has_assignments");
    expect(await activeAssignmentsIn(folderId)).toBe(1);
  });

  test("a refused delete leaves the assignments of deleted hosts untouched", async () => {
    const folderId = await createFolder();
    const goneDoc = await createDocIn(folderId, "team-a");
    await createDocIn(folderId, "team-a");
    await asRawClient(stack.db).unsafe(`DELETE FROM ${DOC_TABLE} WHERE id = $1`, [goneDoc]);

    const err = await stack.http.writeErr(FoldersHandlers.deleteFolder, { id: folderId }, userA);
    expect(reasonOf(err)).toBe("folder_has_assignments");
    expect(await activeAssignmentsIn(folderId)).toBe(2);
  });
});
