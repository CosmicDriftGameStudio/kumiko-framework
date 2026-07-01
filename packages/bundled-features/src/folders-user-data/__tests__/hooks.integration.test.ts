// folderAssignmentExportHook — GDPR export must not surface cleared
// (soft-deleted) folder-assignment rows. Regression (658/3): the hook read
// via selectMany without an isDeleted filter — folderAssignmentEntity is
// softDelete: true, so a cleared assignment (clear-folder) still had a row
// in read_folder_assignments and rode along in the export.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createFoldersFeature, FoldersHandlers } from "../../folders";
import { folderAssignmentEntity, folderEntity } from "../../folders/entity";
import { folderAssignmentExportHook } from "../hooks";

let stack: TestStack;
const admin = createTestUser({ roles: ["TenantAdmin"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [createFoldersFeature()] });
  await unsafeCreateEntityTable(stack.db, folderEntity);
  await unsafeCreateEntityTable(stack.db, folderAssignmentEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("folderAssignmentExportHook", () => {
  test("excludes a cleared (soft-deleted) assignment from the export", async () => {
    const folder = await stack.http.writeOk<{ id: string }>(
      FoldersHandlers.createFolder,
      { name: "Active loans" },
      admin,
    );

    await stack.http.writeOk(
      FoldersHandlers.setFolder,
      { folderId: folder.id, entityType: "credit", entityId: "credit-kept" },
      admin,
    );
    await stack.http.writeOk(
      FoldersHandlers.setFolder,
      { folderId: folder.id, entityType: "credit", entityId: "credit-cleared" },
      admin,
    );
    // clear-folder soft-deletes the assignment row (isDeleted: true).
    await stack.http.writeOk(
      FoldersHandlers.clearFolder,
      { entityType: "credit", entityId: "credit-cleared" },
      admin,
    );

    const snippet = await folderAssignmentExportHook({
      db: stack.db,
      tenantId: admin.tenantId,
      userId: admin.id,
    });

    expect(snippet).not.toBeNull();
    const entityIds = (snippet?.rows ?? []).map((r) => r["entityId"]);
    expect(entityIds).toContain("credit-kept");
    expect(entityIds).not.toContain("credit-cleared");
  });
});
