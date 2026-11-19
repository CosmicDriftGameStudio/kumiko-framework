// folder:delete used to refuse forever while an assignment pointed at a host
// that was deleted: clear-folder needs a visible host, so nothing could remove
// the assignment. Assignments of gone hosts are now cleaned up by folder:delete
// itself; assignments of live hosts keep blocking.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  asRawClient,
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { deleteRowViaEventStore, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { folderAssignmentEntity, folderEntity } from "../entity.ts";
import { createFoldersFeature } from "../feature.ts";
import { FoldersHandlers } from "../web/constants.ts";

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
  name: "doc",
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

const docTable = buildEntityTable(docEntity);
const docTarget = { table: docTable, entity: docEntity, entityName: "doc" };
const docExecutor = createEventStoreExecutor(docTable, docEntity, { entityName: "doc" });

const hostFixturesFeature = defineFeature("folders-orphan-test-fixtures", (r) => {
  r.entity(docEntity);
});

const userA = createTestUser({ id: 80, roles: ["TenantMember"], claims: { team: "team-a" } });
const userB = createTestUser({ id: 81, roles: ["TenantMember"], claims: { team: "team-b" } });

let stack: TestStack;
let docCounter = 0;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createFoldersFeature({
        parents: ["doc"],
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
  await seedRowViaEventStore(stack.db, docTable, {
    id: docId,
    tenantId: userA.tenantId,
    teamId: team,
  });
  const owner = team === "team-a" ? userA : userB;
  await stack.http.writeOk(
    FoldersHandlers.setFolder,
    { folderId, entityType: "doc", entityId: docId },
    owner,
  );
  return docId;
}

async function softDeleteDocs(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await deleteRowViaEventStore(stack.db, docTarget, { id }, { tenantId: userA.tenantId });
  }
}

// docEntity is soft-delete, so only forget (Art. 17 purge) removes a host row on the event path.
async function hardDeleteDocs(ids: readonly string[]): Promise<void> {
  const tenantDb = createTenantDb({ db: stack.db, tenantId: userA.tenantId });
  for (const id of ids) {
    const result = await docExecutor.forget({ id }, createSystemUser(userA.tenantId), tenantDb);
    if (!result.isSuccess) throw new Error(`forget doc ${id} failed: ${result.error.code}`);
  }
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
  test("soft-deleted hosts no longer block folder:delete and all their assignments are removed", async () => {
    const folderId = await createFolder();
    const doc1 = await createDocIn(folderId, "team-a");
    const doc2 = await createDocIn(folderId, "team-a");
    const doc3 = await createDocIn(folderId, "team-a");
    await softDeleteDocs([doc1, doc2, doc3]);

    await stack.http.writeOk(FoldersHandlers.deleteFolder, { id: folderId }, userA);
    expect(await activeAssignmentsIn(folderId)).toBe(0);
  });

  test("hard-deleted hosts no longer block folder:delete", async () => {
    const folderId = await createFolder();
    const doc1 = await createDocIn(folderId, "team-a");
    const doc2 = await createDocIn(folderId, "team-a");
    await hardDeleteDocs([doc1, doc2]);

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
    await hardDeleteDocs([goneDoc]);

    const err = await stack.http.writeErr(FoldersHandlers.deleteFolder, { id: folderId }, userA);
    expect(reasonOf(err)).toBe("folder_has_assignments");
    expect(await activeAssignmentsIn(folderId)).toBe(2);
  });
});
