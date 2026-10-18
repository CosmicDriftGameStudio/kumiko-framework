// A save may only name fileRefs that are pending uploads or already belong to the record:
// a file bound to another record of the same tenant is rejected, so the record cannot expose
// it to its own readers. Real stack, real HTTP calls.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { selectMany } from "../../db/query.ts";
import {
  createEntity,
  createFileField,
  createFilesField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createLocalProvider } from "../local-provider.ts";

const folderEntity = createEntity({
  table: "cross_record_folders",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    main: createFileField(),
    alt: createFileField(),
    docs: createFilesField(),
  },
});

const ROLES = { access: { roles: ["Admin"] } } as const;

const folderFeature = defineFeature("cross-record", (r) => {
  r.entity({ name: "folder", ...folderEntity });
  r.writeHandler(defineEntityCreateHandler("folder", folderEntity, ROLES));
  r.writeHandler(defineEntityUpdateHandler("folder", folderEntity, ROLES));
});

const CREATE = "cross-record:write:folder:create";
const UPDATE = "cross-record:write:folder:update";

let stack: TestStack;
let storagePath: string;
const user = createTestUser({ id: 1, tenantId: testTenantId(1), roles: ["Admin"] });

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-cross-record-"));
  stack = await setupTestStack({
    features: [createFilesFeature(), folderFeature],
    files: { storageProvider: createLocalProvider(storagePath) },
  });
  await unsafeCreateEntityTable(stack.db, folderEntity);
});

afterAll(async () => {
  await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

async function upload(target?: { entityType: string; fieldName: string }): Promise<string> {
  const fd = new FormData();
  if (target) {
    fd.append("entityType", target.entityType);
    fd.append("fieldName", target.fieldName);
  }
  fd.append(
    "file",
    new File([Buffer.from("%PDF-1.4 minimal")], "doc.pdf", { type: "application/pdf" }),
  );
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await stack.jwt.sign(user)}`,
      "Content-Type": contentType,
    },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function boundTo(fileRefId: string): Promise<unknown> {
  const [row] = await selectMany<Record<string, unknown>>(stack.db, fileRefsTable, {
    id: fileRefId,
  });
  return row?.["entityId"];
}

// Folder A with one bound file, as a victim record whose file another record tries to name.
async function folderWithBoundFile(): Promise<{ folderId: string; fileRefId: string }> {
  const fileRefId = await upload({ entityType: "folder", fieldName: "main" });
  const created = await stack.http.writeOk<{ id: string }>(
    CREATE,
    { title: "A", main: fileRefId },
    user,
  );
  expect(await boundTo(fileRefId)).toBe(created.id);
  return { folderId: created.id, fileRefId };
}

describe("a save cannot name a file that is bound to another record", () => {
  test("create with another record's file is rejected as invalid_element; the file stays bound to its record", async () => {
    const a = await folderWithBoundFile();

    const err = await stack.http.writeErr(CREATE, { title: "B", main: a.fileRefId }, user);

    expect(err.code).toBe("validation_error");
    expect(JSON.stringify(err.details)).toContain("invalid_element");
    expect(JSON.stringify(err)).not.toContain(a.folderId);
    expect(await boundTo(a.fileRefId)).toBe(a.folderId);
  });

  test("update (single and files field) with another record's file is rejected; the file stays bound", async () => {
    const a = await folderWithBoundFile();
    const b = await stack.http.writeOk<{ id: string }>(CREATE, { title: "B" }, user);

    for (const changes of [{ alt: a.fileRefId }, { docs: [a.fileRefId] }]) {
      const err = await stack.http.writeErr(UPDATE, { id: b.id, version: 1, changes }, user);
      expect(err.code).toBe("validation_error");
    }
    expect(await boundTo(a.fileRefId)).toBe(a.folderId);
  });

  test("a pending upload is accepted and gets bound to the saving record", async () => {
    const pending = await upload({ entityType: "folder", fieldName: "main" });
    const created = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { title: "P", main: pending },
      user,
    );
    expect(await boundTo(pending)).toBe(created.id);

    const unattached = await upload();
    await stack.http.writeOk(CREATE, { title: "U", alt: unattached }, user);
  });

  test("an update that repeats an id the record already holds is accepted", async () => {
    const a = await folderWithBoundFile();
    await stack.http.writeOk(
      UPDATE,
      { id: a.folderId, version: 1, changes: { main: a.fileRefId, title: "A2" } },
      user,
    );
    expect(await boundTo(a.fileRefId)).toBe(a.folderId);
  });

  test("moving a file between two fields of the same record is accepted", async () => {
    const a = await folderWithBoundFile();
    await stack.http.writeOk(
      UPDATE,
      { id: a.folderId, version: 1, changes: { alt: a.fileRefId } },
      user,
    );
    expect(await boundTo(a.fileRefId)).toBe(a.folderId);
  });
});
