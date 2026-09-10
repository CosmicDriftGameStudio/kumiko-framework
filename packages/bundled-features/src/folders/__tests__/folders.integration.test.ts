// Full-stack integration for the folders bundle. Drives create → set → list →
// move → clear through the real dispatcher + entity-projection + DB. Proves the
// architecture end-to-end WITHOUT any host wiring (folders are host-agnostic —
// the host is just the entityType/entityId strings on the assignment):
//   - create-folder projects into read_folders (incl. nested parentId)
//   - set-folder projects a SINGLE membership row keyed by (entityType, entityId)
//   - re-setting to a different folder MOVES the entity (still one row) — the
//     defining difference from tags' many-to-many
//   - clear-folder unfiles; set → clear → set resurrects the deterministic stream
//   - referential integrity (unknown folderId rejected) + multi-tenant isolation
//
// set-folder/clear-folder verify that entityType names a registered entity and
// that the host row is visible to the caller. This file's assertions are about
// membership mechanics, not parent ownership, so the `credit` fixture below
// stays unrestricted (no `access`) on purpose — every host row this file files
// is seeded in beforeAll.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { v5 as uuidv5 } from "uuid";
import { folderAssignmentDeleteHook, folderDeleteHook } from "../../folders-user-data/hooks";
import { FoldersHandlers, FoldersQueries } from "../constants";
import { folderAssignmentEntity, folderEntity } from "../entity";
import { createFoldersFeature } from "../feature";

const foldersFeature = createFoldersFeature();

const CREDIT_TABLE = "folders_test_credits";
const creditEntity = createEntity({
  table: CREDIT_TABLE,
  fields: { name: createTextField({ required: true, maxLength: 64 }) },
});
const hostFixturesFeature = defineFeature("folders-test-host-fixtures", (r) => {
  r.entity("credit", creditEntity);
});

// The parent entity's ids are uuid-shaped, but the readable labels below carry
// the intent of each case — derive one from the other instead of scattering
// opaque uuid literals through the assertions.
const HOST_FIXTURE_NAMESPACE = "2c8a5f13-7d64-4b90-ae52-0f3d6c9b81e4";
function hostId(label: string): string {
  return uuidv5(label, HOST_FIXTURE_NAMESPACE);
}

const CREDIT_LABELS = [
  "credit-1",
  "credit-2",
  "credit-3",
  "credit-8",
  "credit-never",
  "credit-r",
  "credit-x",
  "credit-occupied",
  "credit-occupied-2",
  "credit-erase",
  "c-y",
];

async function seedHostRows(
  target: TestStack,
  labels: readonly string[],
  tenantId: string,
): Promise<void> {
  for (const label of labels) {
    await asRawClient(target.db).unsafe(
      `INSERT INTO ${CREDIT_TABLE} (id, tenant_id, name) VALUES ($1, $2, $3)`,
      [hostId(label), tenantId, label],
    );
  }
}

let stack: TestStack;

const admin = createTestUser({ roles: ["TenantAdmin"] });
const otherTenant = createTestUser({
  roles: ["TenantAdmin"],
  tenantId: "00000000-0000-4000-8000-0000000000aa",
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [foldersFeature, hostFixturesFeature] });
  await unsafeCreateEntityTable(stack.db, folderEntity);
  await unsafeCreateEntityTable(stack.db, folderAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, creditEntity);
  await createEventsTable(stack.db);
  await seedHostRows(stack, CREDIT_LABELS, admin.tenantId);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_folders");
  await asRawClient(stack.db).unsafe("DELETE FROM read_folder_assignments");
});

async function createFolder(name: string, parentId?: string, user = admin): Promise<string> {
  const payload = parentId === undefined ? { name } : { name, parentId };
  const folder = await stack.http.writeOk<{ id: string }>(
    FoldersHandlers.createFolder,
    payload,
    user,
  );
  return folder.id;
}

async function setFolder(folderId: string, entityId: string, user = admin) {
  return stack.http.writeOk(
    FoldersHandlers.setFolder,
    { folderId, entityType: "credit", entityId },
    user,
  );
}

async function clearFolder(entityId: string, user = admin) {
  return stack.http.writeOk(FoldersHandlers.clearFolder, { entityType: "credit", entityId }, user);
}

async function listFolders(user = admin): Promise<Array<Record<string, unknown>>> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    FoldersQueries.folderList,
    {},
    user,
  );
  return res.rows;
}

async function assignmentsOf(
  entityId: string,
  user = admin,
): Promise<Array<Record<string, unknown>>> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    FoldersQueries.assignmentList,
    { filter: { field: "entityId", op: "eq", value: entityId } },
    user,
  );
  return res.rows;
}

// Active assignments only — clear soft-deletes (the stream is kept so a re-set
// can restore it), so isDeleted=true rows must not count as filed.
async function countAssignments(tenantId: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe(
    "SELECT count(*)::int AS n FROM read_folder_assignments WHERE tenant_id = $1 AND is_deleted = FALSE",
    [tenantId],
  );
  return (rows as ReadonlyArray<{ n: number }>)[0]?.n ?? 0;
}

describe("folders integration — catalog (tree)", () => {
  test("create-folder lands in read_folders", async () => {
    const id = await createFolder("Immobilie Berlin");
    const folders = await listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]?.["id"]).toBe(id);
    expect(folders[0]?.["name"]).toBe("Immobilie Berlin");
    expect(folders[0]?.["parentId"]).toBeNull();
  });

  test("create-folder with parentId nests under the parent", async () => {
    const root = await createFolder("Immobilie Berlin");
    const child = await createFolder("Person Müller", root);
    const folders = await listFolders();
    expect(folders).toHaveLength(2);
    const childRow = folders.find((f) => f["id"] === child);
    expect(childRow?.["parentId"]).toBe(root);
  });
});

describe("folders integration — single-membership set / move / clear", () => {
  test("set-folder files an entity; assignment is queryable", async () => {
    const f = await createFolder("Gruppe A");
    await setFolder(f, hostId("credit-1"));

    const rows = await assignmentsOf(hostId("credit-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["folderId"]).toBe(f);
    expect(rows[0]?.["entityType"]).toBe("credit");
  });

  test("re-setting to a different folder MOVES (still exactly one row)", async () => {
    const a = await createFolder("A");
    const b = await createFolder("B");
    await setFolder(a, hostId("credit-1"));
    expect(await countAssignments(admin.tenantId)).toBe(1);

    await setFolder(b, hostId("credit-1")); // MOVE, not a second assignment
    expect(await countAssignments(admin.tenantId)).toBe(1);
    const rows = await assignmentsOf(hostId("credit-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["folderId"]).toBe(b);
  });

  test("set the same folder twice is an idempotent no-op (one row)", async () => {
    const f = await createFolder("dup");
    await setFolder(f, hostId("credit-2"));
    await setFolder(f, hostId("credit-2"));
    expect(await countAssignments(admin.tenantId)).toBe(1);
  });

  test("clear-folder unfiles the entity", async () => {
    const f = await createFolder("temp");
    await setFolder(f, hostId("credit-3"));
    expect(await countAssignments(admin.tenantId)).toBe(1);

    await clearFolder(hostId("credit-3"));
    expect(await countAssignments(admin.tenantId)).toBe(0);
    expect(await assignmentsOf(hostId("credit-3"))).toHaveLength(0);
  });

  test("clearing a never-filed entity succeeds (idempotent end-state)", async () => {
    await clearFolder(hostId("credit-never"));
    expect(await countAssignments(admin.tenantId)).toBe(0);
  });

  test("set → clear → set resurrects the same deterministic stream", async () => {
    const f = await createFolder("recurring");
    await setFolder(f, hostId("credit-r"));
    await clearFolder(hostId("credit-r"));
    expect(await countAssignments(admin.tenantId)).toBe(0);

    await setFolder(f, hostId("credit-r")); // restore, not 409
    expect(await countAssignments(admin.tenantId)).toBe(1);
    expect((await assignmentsOf(hostId("credit-r")))[0]?.["folderId"]).toBe(f);
  });

  test("set → clear → set into a DIFFERENT folder lands in the new folder", async () => {
    const a = await createFolder("A");
    const b = await createFolder("B");
    await setFolder(a, hostId("credit-x"));
    await clearFolder(hostId("credit-x"));
    await setFolder(b, hostId("credit-x")); // restore + update folderId to b
    const rows = await assignmentsOf(hostId("credit-x"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["folderId"]).toBe(b);
  });
});

describe("folders integration — delete blocks on live assignments (658/1)", () => {
  test("deleting a folder that still holds an assignment is rejected, row survives", async () => {
    const f = await createFolder("occupied");
    await setFolder(f, hostId("credit-occupied"));

    const err = await stack.http.writeErr(FoldersHandlers.deleteFolder, { id: f }, admin);
    expect(err.httpStatus).toBe(422);
    expect((await listFolders()).some((row) => row["id"] === f)).toBe(true);
  });

  test("deleting an empty folder succeeds", async () => {
    const f = await createFolder("empty");
    await stack.http.writeOk(FoldersHandlers.deleteFolder, { id: f }, admin);
    expect((await listFolders()).some((row) => row["id"] === f)).toBe(false);
  });

  test("clearing the assignment first unblocks the delete", async () => {
    const f = await createFolder("occupied-then-cleared");
    await setFolder(f, hostId("credit-occupied-2"));
    await clearFolder(hostId("credit-occupied-2"));

    await stack.http.writeOk(FoldersHandlers.deleteFolder, { id: f }, admin);
    expect((await listFolders()).some((row) => row["id"] === f)).toBe(false);
  });
});

describe("folders integration — rename via folder:update", () => {
  test("update renames, optimistic-locked, bumps version", async () => {
    const id = await createFolder("Alt");
    const before = (await listFolders()).find((f) => f["id"] === id);
    const version = before?.["version"] as number;
    expect(typeof version).toBe("number");

    await stack.http.writeOk(
      FoldersHandlers.updateFolder,
      { id, version, changes: { name: "Neu" } },
      admin,
    );
    const after = (await listFolders()).find((f) => f["id"] === id);
    expect(after?.["name"]).toBe("Neu");
    expect(after?.["version"]).toBe(version + 1);
  });
});

describe("folders integration — referential integrity", () => {
  test("set-folder with an unknown folderId is rejected (no dangling assignment)", async () => {
    const err = await stack.http.writeErr(
      FoldersHandlers.setFolder,
      {
        folderId: "00000000-0000-4000-8000-00000000dead",
        entityType: "credit",
        entityId: hostId("c-y"),
      },
      admin,
    );
    expect(err.httpStatus).toBe(404);
    expect(await countAssignments(admin.tenantId)).toBe(0);
  });
});

describe("folders integration — multi-tenant isolation", () => {
  test("tenant B sees neither tenant A's folders nor assignments", async () => {
    const f = await createFolder("A-only", undefined, admin);
    await setFolder(f, hostId("credit-8"), admin);

    expect(await listFolders(otherTenant)).toHaveLength(0);
    expect(await assignmentsOf(hostId("credit-8"), otherTenant)).toHaveLength(0);

    expect(await listFolders(admin)).toHaveLength(1);
    expect(await countAssignments(admin.tenantId)).toBe(1);
    expect(await countAssignments(otherTenant.tenantId)).toBe(0);
  });
});

// The access option must reach the runtime: a host mounting folders with
// openToAll lets a user WITHOUT any default folder role file freely (the exact
// failure that bit money-horse, whose signup users carry "Admin").
describe("folders integration — openToAll access model", () => {
  let openStack: TestStack;
  const unprivileged = createTestUser({ roles: ["Viewer"] });

  beforeAll(async () => {
    openStack = await setupTestStack({
      features: [createFoldersFeature({ access: { openToAll: true } }), hostFixturesFeature],
    });
    await unsafeCreateEntityTable(openStack.db, folderEntity);
    await unsafeCreateEntityTable(openStack.db, folderAssignmentEntity);
    await unsafeCreateEntityTable(openStack.db, creditEntity);
    await createEventsTable(openStack.db);
    await seedHostRows(openStack, ["c-1"], unprivileged.tenantId);
  });

  afterAll(async () => {
    await openStack.cleanup();
  });

  test("a non-folder-role user can create, set, list and clear", async () => {
    const folder = await openStack.http.writeOk<{ id: string }>(
      FoldersHandlers.createFolder,
      { name: "Ordner A" },
      unprivileged,
    );
    await openStack.http.writeOk(
      FoldersHandlers.setFolder,
      { folderId: folder.id, entityType: "credit", entityId: hostId("c-1") },
      unprivileged,
    );
    const folders = await openStack.http.queryOk<{ rows: unknown[] }>(
      FoldersQueries.folderList,
      {},
      unprivileged,
    );
    expect(folders.rows).toHaveLength(1);
    await openStack.http.writeOk(
      FoldersHandlers.clearFolder,
      { entityType: "credit", entityId: hostId("c-1") },
      unprivileged,
    );
  });

  test("the SAME user is denied on a default-role-mounted feature", async () => {
    const denied = await stack.http.writeErr(
      FoldersHandlers.createFolder,
      { name: "nope" },
      unprivileged,
    );
    expect(denied.httpStatus).toBe(403);
  });
});

// GDPR Art. 17 forget: the folder tables are tenant-scoped (no per-user owner
// column), so per-user erasure via these hooks is only safe when the tenant
// is effectively single-user. A wrong/missing guard here would delete
// co-members' folders on a shared tenant — exercise the hooks directly
// (not a synthetic stand-in) against real seeded rows.
describe("folders-user-data — tenantScopedDelete hooks", () => {
  async function seedOneFolderWithAssignment(): Promise<void> {
    const f = await createFolder("to-be-erased");
    await setFolder(f, hostId("credit-erase"));
  }

  test("multi-user tenant: no-op, rows survive", async () => {
    await seedOneFolderWithAssignment();
    const ctx = {
      db: stack.db,
      registry: stack.registry,
      tenantId: admin.tenantId,
      userId: admin.id,
      tenantModel: "multi-user" as const,
    };
    await folderDeleteHook(ctx, "delete");
    await folderAssignmentDeleteHook(ctx, "delete");
    expect(await listFolders()).toHaveLength(1);
    expect(await countAssignments(admin.tenantId)).toBe(1);
  });

  test("anonymize strategy: no-op even on a single-user tenant", async () => {
    await seedOneFolderWithAssignment();
    const ctx = {
      db: stack.db,
      registry: stack.registry,
      tenantId: admin.tenantId,
      userId: admin.id,
      tenantModel: "single-user" as const,
    };
    await folderDeleteHook(ctx, "anonymize");
    await folderAssignmentDeleteHook(ctx, "anonymize");
    expect(await listFolders()).toHaveLength(1);
    expect(await countAssignments(admin.tenantId)).toBe(1);
  });

  test("single-user tenant + delete: rows are purged", async () => {
    await seedOneFolderWithAssignment();
    const ctx = {
      db: stack.db,
      registry: stack.registry,
      tenantId: admin.tenantId,
      userId: admin.id,
      tenantModel: "single-user" as const,
    };
    await folderDeleteHook(ctx, "delete");
    await folderAssignmentDeleteHook(ctx, "delete");
    expect(await listFolders()).toHaveLength(0);
    expect(await countAssignments(admin.tenantId)).toBe(0);
  });
});
