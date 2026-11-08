// A file attached to a record of tenant A is readable from tenant B only when its entity declares
// crossTenantFileRead and the declared query admits that user. Real stack, real HTTP calls.
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
import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import * as z from "zod";
import {
  createEntity,
  createFileField,
  createImageField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
  EXT_DERIVATIVE_RENDERER,
  type SessionUser,
} from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature, createInMemoryFileProvider } from "../index.ts";

const requestEntity = createEntity({
  table: "xt_file_read_requests",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    photo: createImageField({ variants: { thumb: { maxEdge: 50 } } }),
  },
  crossTenantFileRead: {
    query: "xtfiles:query:request:buyer-view",
    reason: "traders see the photos of requests shared with them",
  },
});

const plainEntity = createEntity({
  table: "xt_file_read_plains",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    photo: createFileField(),
  },
});

const looseEntity = createEntity({
  table: "xt_file_read_looses",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    photo: createFileField(),
  },
  crossTenantFileRead: {
    query: "xtfiles:query:loose:buyer-view",
    reason: "declared query ignores the id and answers an empty object",
  },
});

const ADMIN_ONLY = { access: { roles: ["Admin"] } } as const;

// Only the shared record is visible to a grantee; any other id answers null.
let sharedRequestId = "";

const VARIANT_BYTES = new Uint8Array([7, 7, 7]);
const stubRenderer: DerivativeRendererPlugin = { render: async () => VARIANT_BYTES };
const provider = createInMemoryFileProvider();

const xtFeature = defineFeature("xtfiles", (r) => {
  r.entity({ name: "request", ...requestEntity });
  r.entity({ name: "plain", ...plainEntity });
  r.entity({ name: "loose", ...looseEntity });
  r.writeHandler(defineEntityCreateHandler("loose", looseEntity, ADMIN_ONLY));
  r.writeHandler(defineEntityUpdateHandler("loose", looseEntity, ADMIN_ONLY));
  r.queryHandler(defineEntityDetailHandler("loose", looseEntity, ADMIN_ONLY));
  r.writeHandler(defineEntityCreateHandler("request", requestEntity, ADMIN_ONLY));
  r.queryHandler(defineEntityDetailHandler("request", requestEntity, ADMIN_ONLY));
  r.writeHandler(defineEntityUpdateHandler("request", requestEntity, ADMIN_ONLY));
  r.writeHandler(defineEntityUpdateHandler("plain", plainEntity, ADMIN_ONLY));
  r.writeHandler(defineEntityCreateHandler("plain", plainEntity, ADMIN_ONLY));
  r.queryHandler(defineEntityDetailHandler("plain", plainEntity, ADMIN_ONLY));
  r.extendsRegistrar(EXT_DERIVATIVE_RENDERER, {});
  r.useExtension(EXT_DERIVATIVE_RENDERER, "image/png", stubRenderer);
  r.queryHandler({
    name: "request:buyer-view",
    schema: z.object({ id: z.string() }),
    access: { roles: ["User"] },
    handler: async (event) =>
      event.payload.id === sharedRequestId ? { id: sharedRequestId } : null,
  });
  r.queryHandler({
    name: "loose:buyer-view",
    schema: z.object({ id: z.string() }),
    access: { roles: ["User"] },
    handler: async () => ({}),
  });
  r.queryHandler({
    name: "plain:buyer-view",
    schema: z.object({ id: z.string() }),
    access: { roles: ["User"] },
    handler: async (event) => ({ id: event.payload.id }),
  });
});

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

const ownerAdmin = createTestUser({ id: 1, tenantId: testTenantId(1), roles: ["Admin"] });
const grantee = createTestUser({ id: 2, tenantId: testTenantId(2), roles: ["User"] });
const foreignAdmin = createTestUser({ id: 3, tenantId: testTenantId(2), roles: ["Admin"] });

let stack: TestStack;
let sharedFileId = "";
let unsharedFileId = "";
let plainFileId = "";
let looseFileId = "";

async function upload(
  as: SessionUser,
  fields: { entityType: string; entityId: string; fieldName: string },
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const formData = new FormData();
  formData.append("file", new File([Buffer.from(PNG_BYTES)], "photo.png", { type: "image/png" }));
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  const { body, contentType } = await buildMultipartBody(formData);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function get(path: string, as: SessionUser, method = "GET"): Promise<Response> {
  const token = await stack.jwt.sign(as);
  return stack.app.request(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function attachPhoto(entity: "request" | "plain" | "loose"): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    `xtfiles:write:${entity}:create`,
    { title: "t" },
    ownerAdmin,
  );
  if (entity === "request" && sharedRequestId === "") sharedRequestId = created.id;
  return upload(ownerAdmin, { entityType: entity, entityId: created.id, fieldName: "photo" });
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), xtFeature],
    files: { storageProvider: provider },
  });
  await unsafeCreateEntityTable(stack.db, requestEntity, "request");
  await unsafeCreateEntityTable(stack.db, plainEntity, "plain");
  await unsafeCreateEntityTable(stack.db, looseEntity, "loose");
  sharedFileId = await attachPhoto("request");
  unsharedFileId = await attachPhoto("request");
  plainFileId = await attachPhoto("plain");
  looseFileId = await attachPhoto("loose");
});

afterAll(async () => {
  await stack.cleanup();
});

describe("crossTenantFileRead", () => {
  test("a user the declared query admits reads download, download-url and meta", async () => {
    const download = await get(`/files/${sharedFileId}`, grantee);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG_BYTES);

    const meta = await get(`/files/${sharedFileId}/meta`, grantee);
    expect(meta.status).toBe(200);
    expect(((await meta.json()) as { fileName: string }).fileName).toBe("photo.png");

    const batch = await get(`/files/meta?ids=${sharedFileId},${unsharedFileId}`, grantee);
    expect(((await batch.json()) as { files: { id: string }[] }).files.map((f) => f.id)).toEqual([
      sharedFileId,
    ]);

    expect((await get(`/files/${sharedFileId}/download-url`, grantee)).status).toBe(200);
    expect((await get(`/files/${unsharedFileId}/download-url`, grantee)).status).toBe(404);
  });

  test("a record the query answers null for stays hidden", async () => {
    expect((await get(`/files/${unsharedFileId}`, grantee)).status).toBe(404);
    expect((await get(`/files/${unsharedFileId}/meta`, grantee)).status).toBe(404);
  });

  test("a query that ignores the id and answers an empty object grants nothing", async () => {
    expect((await get(`/files/${looseFileId}`, grantee)).status).toBe(404);
    expect((await get(`/files/${looseFileId}/meta`, grantee)).status).toBe(404);
  });

  test("a named variant of a foreign file follows the query and lives in the owner tenant", async () => {
    const granted = await get(`/files/${sharedFileId}/variant/thumb`, grantee);
    expect(granted.status).toBe(200);
    expect(new Uint8Array(await granted.arrayBuffer())).toEqual(VARIANT_BYTES);
    const ownerKeys = provider.keys().filter((key) => key.includes(testTenantId(1)));
    expect(ownerKeys.some((key) => key.includes("thumb") || key.includes("variant"))).toBe(true);
    expect(provider.keys().some((key) => key.includes(testTenantId(2)))).toBe(false);

    expect((await get(`/files/${sharedFileId}/variant/thumb`, foreignAdmin)).status).toBe(404);
    expect((await get(`/files/${unsharedFileId}/variant/thumb`, grantee)).status).toBe(404);
  });

  test("an entity without the declaration stays hidden", async () => {
    expect((await get(`/files/${plainFileId}`, grantee)).status).toBe(404);
    expect((await get(`/files/${plainFileId}/meta`, grantee)).status).toBe(404);
  });

  test("an admin of the other tenant without the query grant is refused", async () => {
    expect((await get(`/files/${sharedFileId}`, foreignAdmin)).status).toBe(404);
    expect((await get(`/files/${sharedFileId}/meta`, foreignAdmin)).status).toBe(404);
  });

  test("delete from the other tenant is refused and the file survives", async () => {
    expect((await get(`/files/${sharedFileId}`, grantee, "DELETE")).status).toBe(404);
    expect((await get(`/files/${sharedFileId}`, ownerAdmin)).status).toBe(200);
  });
});
