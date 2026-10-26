// canCallerReadFileRef: the handler-side twin of GET /files/:id. Real stack, real HTTP calls.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import { selectMany } from "../../db/query.ts";
import {
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineFeature,
} from "../../engine/index.ts";
import { createSystemUser, SYSTEM_ROLE } from "../../engine/system-user.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { canCallerReadFileRef } from "../can-caller-read-file-ref.ts";
import { createFileRefFromBytes } from "../create-file-ref-from-bytes.ts";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  type FileRef,
  fileRefsTable,
} from "../index.ts";

const noteEntity = createEntity({
  table: "can_read_notes",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    attachment: createFileField(),
  },
});

const feature = defineFeature("can-read", (r) => {
  r.entity({ name: "note", ...noteEntity });
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
  r.queryHandler({
    name: "can-read",
    schema: z.object({ fileRefId: z.string() }),
    access: { roles: ["Admin", "User", "Clerk"] },
    handler: async (event, ctx) => {
      const [row] = await selectMany(ctx.db, fileRefsTable, { id: event.payload.fileRefId });
      if (row === undefined) return false;
      // @cast-boundary db-row — the file_refs row has exactly the FileRef columns
      return canCallerReadFileRef(ctx, row as unknown as FileRef);
    },
  });
});

const tenant = testTenantId(1);
const owner = createTestUser({ id: 1, tenantId: tenant, roles: ["User"] });
const clerk = createTestUser({ id: 2, tenantId: tenant, roles: ["Clerk"] });
const admin = createTestUser({ id: 3, tenantId: tenant, roles: ["Admin"] });

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), feature],
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

async function renderSystemFile(): Promise<string> {
  const rendered = await stack.dispatcher.write(
    "can-read:write:render",
    {},
    createSystemUser(tenant),
  );
  if (!rendered.isSuccess) throw new Error("render fixture failed");
  return z.object({ id: z.string() }).parse(rendered.data).id;
}

async function canRead(as: typeof owner, fileRefId: string): Promise<boolean> {
  return z.boolean().parse(await stack.http.queryOk("can-read:query:can-read", { fileRefId }, as));
}

async function uploadForNote(as: typeof owner): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  fd.append("entityType", "note");
  fd.append("fieldName", "attachment");
  fd.append(
    "file",
    new File([Buffer.from("%PDF-1.4 minimal")], "doc.pdf", { type: "application/pdf" }),
  );
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return z.object({ id: z.string() }).parse(await res.json()).id;
}

describe("canCallerReadFileRef", () => {
  test("a user without read right on the bound record gets false", async () => {
    const fileRefId = await uploadForNote(owner);
    await stack.http.writeOk(
      "can-read:write:note:create",
      { title: "Private", attachment: fileRefId },
      owner,
    );

    expect(await canRead(owner, fileRefId)).toBe(true);
    expect(await canRead(clerk, fileRefId)).toBe(false);
  });

  test("a non-admin on a system file without binding gets false, an admin true", async () => {
    const fileRefId = await renderSystemFile();

    expect(await canRead(owner, fileRefId)).toBe(false);
    expect(await canRead(admin, fileRefId)).toBe(true);
  });
});
