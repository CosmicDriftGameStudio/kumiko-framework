// POST /files with an entityId attaches a file to a stored record, so it needs the same
// rights as saving that record: update handler access, row and field write rules, and no
// lock. A rejected upload must not leave bytes behind.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildMultipartBody,
  createBarrier,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { asRawClient, selectMany } from "../../db/query.ts";
import {
  createBooleanField,
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
  from,
  type SessionUser,
} from "../../engine/index.ts";
import { createTestUser, TestUsers } from "../../seeding/seed-users.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  type InMemoryFileProvider,
} from "../index.ts";

const PNG_BYTES = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...Array(12).fill(0),
]);

const dossierEntity = createEntity({
  table: "upload_check_dossiers",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    scan: createFileField(),
    isSealed: createBooleanField({ default: false }),
  },
  lockedWhen: { field: "isSealed", eq: true },
});

const ownedEntity = createEntity({
  table: "upload_check_owned",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    scan: createFileField(),
    ownerId: createTextField({ personal: false, reason: "test_fixture" }),
  },
  access: { write: { Admin: from("user:id", "ownerId") } },
});

const ADMIN_ONLY = { access: { roles: ["Admin"] } } as const;
const READERS = { access: { roles: ["Admin", "User"] } } as const;

const uploadFeature = defineFeature("uploadcheck", (r) => {
  r.entity({ name: "dossier", ...dossierEntity });
  r.entity({ name: "owned", ...ownedEntity });
  r.writeHandler(defineEntityCreateHandler("dossier", dossierEntity, ADMIN_ONLY));
  r.writeHandler(defineEntityUpdateHandler("dossier", dossierEntity, ADMIN_ONLY));
  r.queryHandler(defineEntityDetailHandler("dossier", dossierEntity, READERS));
  r.writeHandler(defineEntityCreateHandler("owned", ownedEntity, ADMIN_ONLY));
  r.writeHandler(defineEntityUpdateHandler("owned", ownedEntity, ADMIN_ONLY));
  r.queryHandler(defineEntityDetailHandler("owned", ownedEntity, READERS));
});

const provider = createInMemoryFileProvider();
// Lets a test act between the upload's access check and its row insert: the bytes are written in between.
let beforeBytesLand: (() => Promise<void>) | undefined;
const gatedProvider: InMemoryFileProvider = {
  ...provider,
  write: async (key, data, mimeType) => {
    await beforeBytesLand?.();
    return provider.write(key, data, mimeType);
  },
};
let stack: TestStack;
const admin = TestUsers.admin;
const otherAdmin = createTestUser({ id: 5, tenantId: admin.tenantId, roles: ["Admin"] });

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), uploadFeature],
    files: { storageProvider: gatedProvider },
  });
  await unsafeCreateEntityTable(stack.db, dossierEntity, "dossier");
  await unsafeCreateEntityTable(stack.db, ownedEntity, "owned");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  beforeBytesLand = undefined;
  provider.clear();
  await asRawClient(stack.db).unsafe(
    `TRUNCATE upload_check_dossiers, upload_check_owned, file_refs RESTART IDENTITY CASCADE`,
  );
});

type UploadFields = {
  readonly entityType?: string;
  readonly entityId?: string;
  readonly fieldName?: string;
};

async function upload(
  user: SessionUser,
  fields: UploadFields,
): Promise<{ status: number; body: unknown }> {
  const token = await stack.jwt.sign(user);
  const formData = new FormData();
  formData.append("file", new File([Buffer.from(PNG_BYTES)], "scan.png", { type: "image/png" }));
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  const { body, contentType } = await buildMultipartBody(formData);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  return { status: res.status, body: await res.json() };
}

async function createDossier(isSealed = false): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "uploadcheck:write:dossier:create",
    { title: "d", isSealed },
    admin,
  );
  return created.id;
}

async function createOwned(ownerId: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "uploadcheck:write:owned:create",
    { title: "o", ownerId },
    admin,
  );
  return created.id;
}

describe("POST /files with an entityId", () => {
  test("a user who may update the record can attach a file", async () => {
    const id = await createDossier();
    const res = await upload(admin, { entityType: "dossier", entityId: id, fieldName: "scan" });
    expect(res.status).toBe(201);
    expect(provider.keys()).toHaveLength(1);
  });

  test("a foreign tenant and a missing record answer identically with 404", async () => {
    const id = await createDossier();
    const foreign = await upload(TestUsers.otherTenant, {
      entityType: "dossier",
      entityId: id,
      fieldName: "scan",
    });
    const missing = await upload(TestUsers.otherTenant, {
      entityType: "dossier",
      entityId: crypto.randomUUID(),
      fieldName: "scan",
    });
    expect(foreign.status).toBe(404);
    expect(foreign).toEqual(missing);
    expect(provider.keys()).toHaveLength(0);
  });

  test("a role that may read but not update the record gets 403 and no bytes are stored", async () => {
    const id = await createDossier();
    const res = await upload(TestUsers.user, {
      entityType: "dossier",
      entityId: id,
      fieldName: "scan",
    });
    expect(res.status).toBe(403);
    expect(provider.keys()).toHaveLength(0);
  });

  test("an entity write rule that denies the user gets 403", async () => {
    const id = await createOwned(admin.id);
    const res = await upload(otherAdmin, { entityType: "owned", entityId: id, fieldName: "scan" });
    expect(res.status).toBe(403);
    expect(provider.keys()).toHaveLength(0);

    const owner = await upload(admin, { entityType: "owned", entityId: id, fieldName: "scan" });
    expect(owner.status).toBe(201);
  });

  test("a locked record answers 409 record_locked and stores no bytes", async () => {
    const id = await createDossier(true);
    const res = await upload(admin, { entityType: "dossier", entityId: id, fieldName: "scan" });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("record_locked");
    expect(provider.keys()).toHaveLength(0);
  });

  test("a record locked while the bytes upload answers 409 and leaves no row or bytes", async () => {
    const id = await createDossier();
    const uploadReachedBytes = createBarrier({ expected: 2 });
    const recordLocked = createBarrier({ expected: 2 });
    beforeBytesLand = async () => {
      await uploadReachedBytes.arrive();
      await recordLocked.arrive();
    };

    const racing = upload(admin, { entityType: "dossier", entityId: id, fieldName: "scan" });
    await uploadReachedBytes.arrive();
    await stack.http.writeOk(
      "uploadcheck:write:dossier:update",
      { id, version: 1, changes: { isSealed: true } },
      admin,
    );
    await recordLocked.arrive();
    const res = await racing;

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("record_locked");
    expect(await selectMany(stack.db, fileRefsTable, {})).toEqual([]);
    expect(provider.keys()).toHaveLength(0);
  });

  test("an entityId without an entityType is a bad request", async () => {
    const res = await upload(admin, { entityId: crypto.randomUUID() });
    expect(res.status).toBe(400);
    expect(provider.keys()).toHaveLength(0);
  });

  test("a pending upload without an entityId still works", async () => {
    const res = await upload(admin, { entityType: "dossier", fieldName: "scan" });
    expect(res.status).toBe(201);
    expect(provider.keys()).toHaveLength(1);
  });
});
