// Proves the full derive-on-first-use loop through a real sharp render: a
// write-handler calls ctx.derivatives.variant(), the bytes it stores decode
// as the promised format/size, and a second call with the same spec hits the
// cache instead of rendering again.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { createInMemoryFileProvider } from "@cosmicdrift/kumiko-framework/files";
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
import { z } from "zod";
import { createConfigFeature } from "../../config";
import { fileDerivativesFeature } from "../../file-derivatives";
import { fileFoundationFeature } from "../../file-foundation";
import { createFilesFeature } from "../../files";
import { derivativesSharpFeature } from "../feature";
import { imageMetadata } from "../render";

const variantTestFeature = defineFeature("derivativessharptest", (r) => {
  r.requires("file-derivatives");
  r.writeHandler(
    "make-thumb",
    z.object({ fileRefId: z.string() }),
    async (event, ctx) => {
      if (!ctx.derivatives || !ctx.files) {
        return writeFailure(
          new InternalError({ message: "no ctx.derivatives/ctx.files on write-handler ctx" }),
        );
      }
      const result = await ctx.derivatives.variant(
        event.payload.fileRefId,
        { maxEdge: 160, fit: "cover", format: "webp" },
        "thumb",
      );
      const bytes = await ctx.files.ref(result.storageKey).read();
      const meta = await imageMetadata(bytes);
      return { isSuccess: true as const, data: { ...result, ...meta } };
    },
    { access: { openToAll: true } },
  );
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
      fileFoundationFeature,
      createFilesFeature(),
      fileDerivativesFeature,
      derivativesSharpFeature,
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
