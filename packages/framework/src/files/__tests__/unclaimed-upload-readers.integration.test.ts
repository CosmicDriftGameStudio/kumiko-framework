// unclaimedUploadReaders: declarative read access to uploads without a target field. Real
// stack, real HTTP calls.

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
import * as z from "zod";
import { selectMany } from "../../bun-db/index.js";
import {
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineFeature,
} from "../../engine/index.js";
import { createSystemUser, SYSTEM_ROLE } from "../../engine/system-user.js";
import { createTestUser, testTenantId } from "../../seeding/seed-users.js";
import { createFileRefFromBytes } from "../create-file-ref-from-bytes.js";
import { createFilesFeature, type FilesFeatureOptions } from "../feature.js";
import { fileRefsTable } from "../file-ref-table.js";
import { createLocalProvider } from "../local-provider.js";

const noteEntity = createEntity({
  table: "unclaimed_notes",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    attachment: createFileField(),
  },
});

const noteFeature = defineFeature("unclaimed-notes", (r) => {
  r.entity({ name: "note", ...noteEntity });
  // Clerk may create notes but not read other people's: the record rule must not leak files.
  r.writeHandler(
    defineEntityCreateHandler("note", noteEntity, {
      access: { roles: ["Admin", "User", "Clerk", "SystemAdmin"] },
    }),
  );
  r.queryHandler(
    defineEntityDetailHandler("note", noteEntity, {
      access: { roles: ["Admin", "User", "SystemAdmin"] },
    }),
  );
});

// A system-generated document without attachTo, like a rendered letter: unclaimed, but not an inbox upload.
const systemDocFeature = defineFeature("unclaimed-sysdoc", (r) => {
  r.writeHandler({
    name: "render",
    schema: z.object({}),
    handler: (_event, ctx) =>
      createFileRefFromBytes(ctx, {
        fileName: "rendered.pdf",
        mimeType: "application/pdf",
        data: new TextEncoder().encode("%PDF-1.4 rendered"),
      }),
    access: { roles: [SYSTEM_ROLE] },
  });
});

const NOTE_CREATE = "unclaimed-notes:write:note:create";

const tenant = testTenantId(1);
const uploader = createTestUser({ id: 1, tenantId: tenant, roles: ["User"] });
const clerk = createTestUser({ id: 2, tenantId: tenant, roles: ["Clerk"] });
const outsider = createTestUser({ id: 3, tenantId: tenant, roles: ["User"] });
const otherTenantClerk = createTestUser({ id: 4, tenantId: testTenantId(2), roles: ["Clerk"] });

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 minimal");

let storagePath: string;
const stacks: TestStack[] = [];

async function startStack(options: FilesFeatureOptions): Promise<TestStack> {
  const stack = await setupTestStack({
    features: [createFilesFeature(options), noteFeature, systemDocFeature],
    files: {
      storageProvider: {
        ...createLocalProvider(storagePath),
        getSignedUrl: async (storageKey) => `https://files.example.test/${storageKey}`,
      },
    },
  });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  stacks.push(stack);
  return stack;
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-unclaimed-readers-"));
});

afterAll(async () => {
  for (const stack of stacks) await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

async function upload(
  stack: TestStack,
  as: typeof uploader,
  fields: { entityType?: string; fieldName?: string } = {},
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
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

async function request(
  stack: TestStack,
  as: typeof uploader,
  fileRefId: string,
  suffix = "",
  method = "GET",
): Promise<number> {
  const token = await stack.jwt.sign(as);
  const res = await stack.app.request(`/api/files/${fileRefId}${suffix}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status;
}

describe("unclaimedUploadReaders", () => {
  let stack: TestStack;
  beforeAll(async () => {
    stack = await startStack({ unclaimedUploadReaders: ["Clerk"] });
  });

  test("a reader role reads an unclaimed upload and its meta, but cannot delete it", async () => {
    const fileRefId = await upload(stack, uploader);

    expect(await request(stack, clerk, fileRefId)).toBe(200);
    expect(await request(stack, clerk, fileRefId, "/meta")).toBe(200);
    expect(await request(stack, clerk, fileRefId, "", "DELETE")).toBe(404);
    expect(await request(stack, uploader, fileRefId)).toBe(200);
  });

  test("download-url and meta follow the same rule: reader role 200, other tenant 404", async () => {
    const fileRefId = await upload(stack, uploader);

    expect(await request(stack, clerk, fileRefId, "/download-url")).toBe(200);
    expect(await request(stack, clerk, fileRefId, "/meta")).toBe(200);
    expect(await request(stack, otherTenantClerk, fileRefId, "/download-url")).toBe(404);
    expect(await request(stack, otherTenantClerk, fileRefId, "/meta")).toBe(404);
  });

  test("a bound file follows its record's rule, not the role", async () => {
    const fileRefId = await upload(stack, uploader, {
      entityType: "note",
      fieldName: "attachment",
    });
    await stack.http.writeOk(NOTE_CREATE, { title: "Private", attachment: fileRefId }, uploader);

    expect(await request(stack, clerk, fileRefId)).toBe(404);
    expect(await request(stack, uploader, fileRefId)).toBe(200);
  });

  test("a reference from another record does not rebind an unclaimed upload", async () => {
    const fileRefId = await upload(stack, uploader);
    await stack.http.writeOk(NOTE_CREATE, { title: "Clerk note", attachment: fileRefId }, clerk);

    const [row] = await selectMany(stack.db, fileRefsTable, { id: fileRefId });
    expect(row?.["entityId"]).toBeNull();
    expect(await request(stack, uploader, fileRefId)).toBe(200);
  });

  test("a delete by a reader role is refused and the file stays readable for its uploader", async () => {
    const fileRefId = await upload(stack, uploader);

    expect(await request(stack, clerk, fileRefId, "", "DELETE")).toBe(404);
    expect(await request(stack, uploader, fileRefId)).toBe(200);
  });

  test("users without the role and other tenants get 404", async () => {
    const fileRefId = await upload(stack, uploader);

    expect(await request(stack, outsider, fileRefId)).toBe(404);
    expect(await request(stack, otherTenantClerk, fileRefId)).toBe(404);
  });

  test("a system-generated document without a target stays out of reach of the reader role", async () => {
    const rendered = await stack.dispatcher.write(
      "unclaimed-sysdoc:write:render",
      {},
      createSystemUser(tenant),
    );
    if (!rendered.isSuccess) throw new Error("system document fixture failed to render");
    const { id: fileRefId } = z.object({ id: z.string() }).parse(rendered.data);
    const admin = createTestUser({ id: 5, tenantId: tenant, roles: ["Admin"] });

    expect(await request(stack, clerk, fileRefId)).toBe(404);
    expect(await request(stack, clerk, fileRefId, "/meta")).toBe(404);
    expect(await request(stack, admin, fileRefId)).toBe(200);
  });

  test("a pending upload for a target field stays private to its uploader", async () => {
    const fileRefId = await upload(stack, uploader, {
      entityType: "note",
      fieldName: "attachment",
    });

    expect(await request(stack, clerk, fileRefId)).toBe(404);
    expect(await request(stack, uploader, fileRefId)).toBe(200);
  });
});

describe("without unclaimedUploadReaders", () => {
  test("a clerk cannot read someone else's unclaimed upload", async () => {
    const stack = await startStack({});
    const fileRefId = await upload(stack, uploader);

    expect(await request(stack, clerk, fileRefId)).toBe(404);
  });
});
