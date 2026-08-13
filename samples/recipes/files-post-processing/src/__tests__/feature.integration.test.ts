// Files Post-Processing Sample — Integration Test
//
// Proves each of the three variant entry points end-to-end, through real
// HTTP calls and a real sharp render (no identity-transform, no mocks):
//
//   1. declarative — GET /api/files/:id/variant/:name resolves a field's
//      declared variant.
//   2. imperative — the `set-cover` write-handler calls
//      ctx.derivatives.variant() directly, with a region-blur.
//   3. public route — GET /media/:fileRefId/:variant, default-deny until a
//      photo is explicitly published.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { derivativesSharpFeature } from "@cosmicdrift/kumiko-bundled-features/derivatives-sharp";
import { createFileDerivativesFeature } from "@cosmicdrift/kumiko-bundled-features/file-derivatives";
import { fileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-framework/testing";
import sharp from "sharp";
import { coverOrder, filesPostProcessingFeature, publishedPhotoIds } from "../feature";

const HOST = "photos.example.com";
const HOST_B = "photos-b.example.com";

let stack: TestStack;
let provider: InMemoryFileProvider;

const tenantId = testTenantId(1);
const tenantIdB = testTenantId(2);
const user = createTestUser({ id: 1, tenantId, roles: ["Admin"] });
const userB = createTestUser({ id: 2, tenantId: tenantIdB, roles: ["Admin"] });

async function jpegBytes(width: number, height: number): Promise<Uint8Array> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 140, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      fileFoundationFeature,
      createFilesFeature(),
      createFileDerivativesFeature({
        resolveApexTenant: (host) => {
          if (host === HOST) return tenantId;
          if (host === HOST_B) return tenantIdB;
          return null;
        },
      }),
      derivativesSharpFeature,
      filesPostProcessingFeature,
    ],
    files: { storageProvider: provider },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  provider.clear();
  publishedPhotoIds.clear();
  coverOrder.length = 0;
});

async function uploadPhoto(
  attach: { entityType: string; entityId: string; fieldName: string } | null,
  asUser: typeof user = user,
): Promise<string> {
  const token = await stack.jwt.sign(asUser);
  const bytes = await jpegBytes(400, 300);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(bytes)], "photo.jpg", { type: "image/jpeg" }));
  if (attach) {
    fd.append("entityType", attach.entityType);
    fd.append("entityId", attach.entityId);
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

describe("entry point 1 — declarative field variant", () => {
  test("GET /api/files/:id/variant/:name renders a real resized webp", async () => {
    const fileId = await uploadPhoto({
      entityType: "photo",
      entityId: "p1",
      fieldName: "original",
    });
    const token = await stack.jwt.sign(user);

    const res = await stack.app.request(`/api/files/${fileId}/variant/thumb`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(200);
  });
});

describe("entry point 2 — imperative ctx.derivatives.variant() with region-blur", () => {
  test("set-cover derives a variant with no field declaration involved, and tracks order", async () => {
    const fileId = await uploadPhoto(null);

    const result = await stack.http.writeOk<{ fileRefId: string; storageKey: string }>(
      "files-post-processing:write:set-cover",
      { fileRefId: fileId, blurRegion: { x: 0, y: 0, width: 50, height: 50 } },
      user,
    );

    expect(coverOrder).toEqual([fileId]);
    const bytes = await provider.read(result.storageKey);
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(800);
  });
});

describe("entry point 3 — public route, default-deny", () => {
  test("unpublished photo → 404", async () => {
    const fileId = await uploadPhoto({
      entityType: "photo",
      entityId: "p2",
      fieldName: "original",
    });

    const res = await stack.app.request(`http://${HOST}/media/${fileId}/thumb`);

    expect(res.status).toBe(404);
  });

  test("photo published via the write-handler → 200 with rendered bytes", async () => {
    const fileId = await uploadPhoto({
      entityType: "photo",
      entityId: "p3",
      fieldName: "original",
    });
    await stack.http.writeOk("files-post-processing:write:publish", { entityId: "p3" }, user);

    const res = await stack.app.request(`http://${HOST}/media/${fileId}/thumb`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });

  test("publishing entityId p3 under tenant A does not publish tenant B's own entityId p3 (#1983/1)", async () => {
    const fileIdA = await uploadPhoto(
      { entityType: "photo", entityId: "p3", fieldName: "original" },
      user,
    );
    const fileIdB = await uploadPhoto(
      { entityType: "photo", entityId: "p3", fieldName: "original" },
      userB,
    );

    await stack.http.writeOk("files-post-processing:write:publish", { entityId: "p3" }, user);

    const resA = await stack.app.request(`http://${HOST}/media/${fileIdA}/thumb`);
    const resB = await stack.app.request(`http://${HOST_B}/media/${fileIdB}/thumb`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(404);
  });
});
