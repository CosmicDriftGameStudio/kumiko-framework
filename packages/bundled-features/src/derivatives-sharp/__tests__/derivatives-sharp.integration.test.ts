// Proves the full derive-on-first-use loop through a real sharp render: a
// write-handler calls ctx.services.derivatives.variant(), the bytes it stores decode
// as the promised format/size, and a second call with the same spec hits the
// cache instead of rendering again.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolveRenderer } from "@cosmicdrift/kumiko-framework/derivatives";
import { defineFeature, EXT_DERIVATIVE_RENDERER } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import sharp from "sharp";
import * as z from "zod";
import { createConfigFeature } from "../../config/index.ts";
import { createFileDerivativesFeature } from "../../file-derivatives/index.ts";
import { createFileFoundationFeature } from "../../file-foundation/index.ts";
import { createDerivativesSharpFeature } from "../feature.ts";
import { imageMetadata, renderImage } from "../render.ts";

const variantTestFeature = defineFeature("derivativessharptest", (r) => {
  r.requires({ features: ["file-derivatives"] });
  r.writeHandler({
    name: "make-thumb",
    schema: z.object({ fileRefId: z.string() }),
    handler: async (event, ctx) => {
      if (!ctx.services.derivatives || !ctx.services.files) {
        return writeFailure(
          new InternalError({ message: "no ctx.derivatives/ctx.files on write-handler ctx" }),
        );
      }
      const result = await ctx.services.derivatives.variant(
        event.payload.fileRefId,
        { maxEdge: 160, fit: "cover", format: "webp" },
        "thumb",
      );
      const bytes = await ctx.services.files.ref(result.storageKey).read();
      const meta = await imageMetadata(bytes);
      return { isSuccess: true as const, data: { ...result, ...meta } };
    },
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
});

let stack: TestStack;
const tenantId = testTenantId(1);
const user = createTestUser({ id: 1, tenantId, roles: ["Admin"] });

async function jpegBytes(width: number, height: number): Promise<Uint8Array> {
  return sharp({ create: { width, height, channels: 3, background: { r: 90, g: 140, b: 200 } } })
    .jpeg()
    .toBuffer();
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createFileFoundationFeature(),
      createFilesFeature(),
      createFileDerivativesFeature(),
      createDerivativesSharpFeature(),
      variantTestFeature,
    ],
    files: { storageProvider: createInMemoryFileProvider() },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

async function uploadJpeg(): Promise<string> {
  const token = await stack.jwt.sign(user);
  const bytes = await jpegBytes(400, 200);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(bytes)], "photo.jpg", { type: "image/jpeg" }));
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

describe("derivatives-sharp — end to end through ctx.derivatives.variant", () => {
  test("first call renders a real webp thumb, second call hits the cache", async () => {
    const fileId = await uploadJpeg();

    const first = await stack.http.writeOk<{
      storageKey: string;
      mimeType: string;
      rendered: boolean;
      width: number;
      height: number;
      format: string;
    }>("derivativessharptest:write:make-thumb", { fileRefId: fileId }, user);

    expect(first.rendered).toBe(true);
    expect(first.mimeType).toBe("image/webp");
    expect(first.format).toBe("webp");
    expect(first.width).toBe(160);
    expect(first.height).toBe(160);

    const second = await stack.http.writeOk<{ rendered: boolean }>(
      "derivativessharptest:write:make-thumb",
      { fileRefId: fileId },
      user,
    );
    expect(second.rendered).toBe(false);
  });
});

describe("derivatives-sharp: which source types get a renderer", () => {
  test.each([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/avif",
    "image/gif",
    "image/tiff",
  ])("%s resolves to the sharp renderer", (mimeType) => {
    expect(resolveRenderer(stack.registry, mimeType)?.render).toBe(renderImage);
  });

  test.each(["image/heic", "image/heif", "image/bmp", "image/svg+xml"])(
    "%s gets no renderer, so the variant routes answer without reading the original",
    (mimeType) => {
      expect(resolveRenderer(stack.registry, mimeType)).toBeUndefined();
    },
  );
});

describe("derivatives-sharp: an exact app renderer wins in either mount order", () => {
  const appRender = async (input: Uint8Array): Promise<Uint8Array> => input;
  const appGifRendererFeature = defineFeature("derivativessharpappgif", (r) => {
    r.requires({ features: ["file-derivatives"] });
    r.applyExtension({
      name: EXT_DERIVATIVE_RENDERER,
      entity: "image/gif",
      render: appRender,
    });
  });

  test.each([
    ["sharp before the app feature", true],
    ["the app feature before sharp", false],
  ])("%s", async (_label, sharpFirst) => {
    const sharpFeature = createDerivativesSharpFeature();
    const orderedRenderers = sharpFirst
      ? [sharpFeature, appGifRendererFeature]
      : [appGifRendererFeature, sharpFeature];
    const orderedStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createFileFoundationFeature(),
        createFilesFeature(),
        createFileDerivativesFeature(),
        ...orderedRenderers,
      ],
      files: { storageProvider: createInMemoryFileProvider() },
    });
    try {
      expect(resolveRenderer(orderedStack.registry, "image/gif")?.render).toBe(appRender);
      expect(resolveRenderer(orderedStack.registry, "image/png")?.render).toBe(renderImage);
    } finally {
      await orderedStack.cleanup();
    }
  });
});
