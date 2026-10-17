// Writes may only reference fileRefs of the writer's own tenant: a record that
// names another tenant's (or a non-existent) file id is rejected and nothing is
// stored. Real stack, real HTTP calls.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEntity,
  createFileField,
  createFilesField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "../../engine/index.js";
import { createSystemUser } from "../../engine/system-user.js";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { buildMultipartBody, patchFileInstanceofForBunTest } from "../../testing/index.js";
import { createFilesFeature } from "../feature.js";
import { createLocalProvider } from "../local-provider.js";

const noteEntity = createEntity({
  table: "tenant_check_notes",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    attachment: createFileField(),
    docs: createFilesField(),
  },
});

const ROLES = { access: { roles: ["Admin", "User", "SystemAdmin"] } } as const;

const noteFeature = defineFeature("tenant-check-notes", (r) => {
  r.entity({ name: "note", ...noteEntity });
  r.writeHandler(defineEntityCreateHandler("note", noteEntity, ROLES));
  r.writeHandler(defineEntityUpdateHandler("note", noteEntity, ROLES));
  r.queryHandler(defineEntityDetailHandler("note", noteEntity, ROLES));
  r.queryHandler(defineEntityListHandler("note", noteEntity, ROLES));
});

const CREATE = "tenant-check-notes:write:note:create";
const UPDATE = "tenant-check-notes:write:note:update";
const DETAIL = "tenant-check-notes:query:note:detail";
const LIST = "tenant-check-notes:query:note:list";

let stack: TestStack;
let storagePath: string;

const userA = createTestUser({ id: 1, tenantId: testTenantId(1), roles: ["Admin"] });
const userB = createTestUser({ id: 2, tenantId: testTenantId(2), roles: ["Admin"] });

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-file-ref-tenant-"));
  stack = await setupTestStack({
    features: [createFilesFeature(), noteFeature],
    files: { storageProvider: createLocalProvider(storagePath) },
  });
  await unsafeCreateEntityTable(stack.db, noteEntity);
});

afterAll(async () => {
  await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 minimal");
const NOT_EXISTING_ID = "0198f2c0-6d1e-7a3b-9c4d-5e6f7a8b9c0d";

async function upload(as: typeof userA): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "doc.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function noteCountOf(as: typeof userA): Promise<number> {
  const list = await stack.http.queryOk<{ rows: readonly unknown[] }>(LIST, {}, as);
  return list.rows.length;
}

describe("file references are tenant-checked on write", () => {
  test("create with a file of another tenant is rejected and nothing is stored", async () => {
    const foreign = await upload(userB);
    const before = await noteCountOf(userA);
    const err = await stack.http.writeErr(CREATE, { title: "Steal", attachment: foreign }, userA);
    expect(err.code).toBe("validation_error");
    expect(await noteCountOf(userA)).toBe(before);
  });

  test("create with the writer's own file succeeds", async () => {
    const own = await upload(userA);
    const created = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { title: "Mine", attachment: own },
      userA,
    );
    const detail = await stack.http.queryOk<{ attachment: string }>(
      DETAIL,
      { id: created.id },
      userA,
    );
    expect(detail.attachment).toBe(own);
  });

  test("update with a file of another tenant is rejected and the record keeps its file", async () => {
    const own = await upload(userA);
    const foreign = await upload(userB);
    const created = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { title: "Keep", attachment: own },
      userA,
    );
    const err = await stack.http.writeErr(
      UPDATE,
      { id: created.id, version: 1, changes: { attachment: foreign } },
      userA,
    );
    expect(err.code).toBe("validation_error");
    const detail = await stack.http.queryOk<{ attachment: string }>(
      DETAIL,
      { id: created.id },
      userA,
    );
    expect(detail.attachment).toBe(own);
  });

  test("a files array with one foreign id is rejected on create and update", async () => {
    const own = await upload(userA);
    const foreign = await upload(userB);
    const createErr = await stack.http.writeErr(
      CREATE,
      { title: "Mixed", docs: [own, foreign] },
      userA,
    );
    expect(createErr.code).toBe("validation_error");

    const created = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { title: "Plural", docs: [own] },
      userA,
    );
    const updateErr = await stack.http.writeErr(
      UPDATE,
      { id: created.id, version: 1, changes: { docs: [own, foreign] } },
      userA,
    );
    expect(updateErr.code).toBe("validation_error");
  });

  test("a well-formed id that does not exist is rejected", async () => {
    const err = await stack.http.writeErr(
      CREATE,
      { title: "Ghost", attachment: NOT_EXISTING_ID },
      userA,
    );
    expect(err.code).toBe("validation_error");
  });

  test("the error names the field but not whether the id exists elsewhere", async () => {
    const foreign = await upload(userB);
    const foreignErr = await stack.http.writeErr(
      CREATE,
      { title: "x", attachment: foreign },
      userA,
    );
    const ghostErr = await stack.http.writeErr(
      CREATE,
      { title: "x", attachment: NOT_EXISTING_ID },
      userA,
    );
    expect(foreignErr.details).toEqual(ghostErr.details);
    expect(JSON.stringify(foreignErr)).not.toContain(foreign);
  });

  test("a system user writing for the tenant may reference the tenant's own file", async () => {
    const own = await upload(userA);
    const result = await stack.dispatcher.write(
      CREATE,
      { title: "By job", attachment: own },
      createSystemUser(userA.tenantId, ["SystemAdmin"]),
    );
    expect(result.isSuccess).toBe(true);
  });
});
