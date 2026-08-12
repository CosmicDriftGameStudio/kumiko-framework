// Proves GET /api/files/:id/variant/:name end-to-end: real HTTP calls
// through the auth+tenant+guard gate, resolveFieldVariant's whitelist, and
// createDerivativesContext's cache path — same "wiring, not unit logic"
// rationale as derivatives-context.integration.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import {
  createEntity,
  createImageField,
  defineFeature,
  EXT_DERIVATIVE_RENDERER,
} from "../../engine";
import { createFilesFeature } from "../../files/feature";
import { createInMemoryFileProvider } from "../../files/in-memory-provider";
import { createTestUser, setupTestStack, type TestStack, testTenantId } from "../../stack";
import { buildMultipartBody, patchFileInstanceofForBunTest } from "../../testing";

const VARIANT_BYTES = new Uint8Array([9, 9, 9]);

let renderCalls = 0;
const fakeRender: DerivativeRendererPlugin["render"] = async () => {
  renderCalls++;
  return VARIANT_BYTES;
};

const photoEntity = createEntity({
  table: "variant_route_photos",
  fields: {
    avatar: createImageField({ variants: { thumb: { maxEdge: 100, format: "webp" } } }),
  },
});

const photoFeature = defineFeature("variantroutetest", (r) => {
  r.entity("photo", photoEntity);
  r.extendsRegistrar(EXT_DERIVATIVE_RENDERER, { onRegister: () => {} });
  r.useExtension(EXT_DERIVATIVE_RENDERER, "image/*", { render: fakeRender });
});

let stack: TestStack;
const tenantId = testTenantId(1);
const user = createTestUser({ id: 1, tenantId, roles: ["Admin"] });
const otherTenantId = testTenantId(2);
const otherTenantUser = createTestUser({ id: 10, tenantId: otherTenantId, roles: ["Admin"] });

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), photoFeature],
    files: { storageProvider: createInMemoryFileProvider() },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

const DEFAULT_ATTACH = { entityType: "photo", fieldName: "avatar" };

// `null` (not the default-param-triggering `undefined`) is the explicit
// "unattached upload" sentinel — a caller passing `undefined` here would
// silently fall back to DEFAULT_ATTACH instead.
async function uploadFile(
  asUser = user,
  attach: { entityType: string; fieldName: string } | null = DEFAULT_ATTACH,
): Promise<string> {
  const token = await stack.jwt.sign(asUser);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from([1, 2, 3])], "avatar.jpg", { type: "image/jpeg" }));
  if (attach !== null) {
    fd.append("entityType", attach.entityType);
    fd.append("fieldName", attach.fieldName);
  }
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: string };
  return json.id;
}

describe("GET /api/files/:id/variant/:name", () => {
  test("returns the rendered bytes with the spec's mimeType", async () => {
    renderCalls = 0;
    const fileId = await uploadFile();
    const token = await stack.jwt.sign(user);

    const res = await stack.app.request(`/api/files/${fileId}/variant/thumb`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(VARIANT_BYTES);
  });

  test("a second call hits the cache — the renderer runs only once", async () => {
    renderCalls = 0;
    const fileId = await uploadFile();
    const token = await stack.jwt.sign(user);

    const first = await stack.app.request(`/api/files/${fileId}/variant/thumb`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const second = await stack.app.request(`/api/files/${fileId}/variant/thumb`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(VARIANT_BYTES);
    expect(renderCalls).toBe(1);
  });

  test("an undeclared variant name returns 404", async () => {
    const fileId = await uploadFile();
    const token = await stack.jwt.sign(user);

    const res = await stack.app.request(`/api/files/${fileId}/variant/nope`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  test("__proto__ as the variant name returns 404", async () => {
    const fileId = await uploadFile();
    const token = await stack.jwt.sign(user);

    const res = await stack.app.request(`/api/files/${fileId}/variant/__proto__`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  test("an unattached upload has no field to resolve a variant from — 404", async () => {
    const fileId = await uploadFile(user, null);
    const token = await stack.jwt.sign(user);

    const res = await stack.app.request(`/api/files/${fileId}/variant/thumb`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  test("a user from a different tenant gets 404 — tenant isolation", async () => {
    const fileId = await uploadFile();
    const token = await stack.jwt.sign(otherTenantUser);

    const res = await stack.app.request(`/api/files/${fileId}/variant/thumb`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  test("no Authorization header does not return 200", async () => {
    const fileId = await uploadFile();

    const res = await stack.app.request(`/api/files/${fileId}/variant/thumb`);

    expect(res.status).toBe(401);
  });

  // createImageField has no `accept` restriction here, so validateFile
  // never rejects a non-image upload against this field — the source
  // mimeType a renderer has to handle is client-controlled, not just a
  // deployment-time mount decision.
  test("a source mimeType with no matching renderer (client uploaded a non-image) returns 415, not a 500", async () => {
    const token = await stack.jwt.sign(user);
    const fd = new FormData();
    fd.append("file", new File([Buffer.from([1, 2, 3])], "doc.pdf", { type: "application/pdf" }));
    fd.append("entityType", "photo");
    fd.append("fieldName", "avatar");
    const { body, contentType } = await buildMultipartBody(fd);
    const uploadRes = await stack.app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body,
    });
    expect(uploadRes.status).toBe(201);
    const { id: fileId } = (await uploadRes.json()) as { id: string };

    const res = await stack.app.request(`/api/files/${fileId}/variant/thumb`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_media_type" });
  });
});
