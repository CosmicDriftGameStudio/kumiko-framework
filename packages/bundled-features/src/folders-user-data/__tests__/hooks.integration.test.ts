// folderAssignmentExportHook — GDPR export must not surface cleared
// (soft-deleted) folder-assignment rows. Regression (658/3): the hook read
// via selectMany without an isDeleted filter — folderAssignmentEntity is
// softDelete: true, so a cleared assignment (clear-folder) still had a row
// in read_folder_assignments and rode along in the export.
//
// set-folder/clear-folder verify that entityType names a registered entity and
// that the host row is visible to the caller, so the two credits below are a
// real registered fixture. The assertion is about the export hook's isDeleted
// filter, not about ownership — the fixture is deliberately unrestricted.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
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

const CREDIT_TABLE = "folders_export_test_credits";
const creditEntity = createEntity({
  table: CREDIT_TABLE,
  fields: { name: createTextField({ required: true, maxLength: 64 }) },
});
const hostFixturesFeature = defineFeature("folders-export-test-host-fixtures", (r) => {
  r.entity("credit", creditEntity);
});

const CREDIT_KEPT = "d0000000-0000-4000-8000-000000000001";
const CREDIT_CLEARED = "d0000000-0000-4000-8000-000000000002";

let stack: TestStack;
const admin = createTestUser({ roles: ["TenantAdmin"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [createFoldersFeature(), hostFixturesFeature] });
  await unsafeCreateEntityTable(stack.db, folderEntity);
  await unsafeCreateEntityTable(stack.db, folderAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, creditEntity);
  await createEventsTable(stack.db);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${CREDIT_TABLE} (id, tenant_id, name) VALUES ($1, $3, 'kept'), ($2, $3, 'cleared')`,
    [CREDIT_KEPT, CREDIT_CLEARED, admin.tenantId],
  );
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
      { folderId: folder.id, entityType: "credit", entityId: CREDIT_KEPT },
      admin,
    );
    await stack.http.writeOk(
      FoldersHandlers.setFolder,
      { folderId: folder.id, entityType: "credit", entityId: CREDIT_CLEARED },
      admin,
    );
    // clear-folder soft-deletes the assignment row (isDeleted: true).
    await stack.http.writeOk(
      FoldersHandlers.clearFolder,
      { entityType: "credit", entityId: CREDIT_CLEARED },
      admin,
    );

    const snippet = await folderAssignmentExportHook({
      db: stack.db,
      registry: stack.registry,
      tenantId: admin.tenantId,
      userId: admin.id,
    });

    expect(snippet).not.toBeNull();
    const entityIds = (snippet?.rows ?? []).map((r) => r["entityId"]);
    expect(entityIds).toContain(CREDIT_KEPT);
    expect(entityIds).not.toContain(CREDIT_CLEARED);
  });
});
