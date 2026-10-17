// A FileRef created server-side by createFileRefFromBytes is a regular,
// tracked FileRef: ctx.derivatives renders variants of it with real sharp.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  createFileRefFromBytes,
  createFilesFeature,
  createInMemoryFileProvider,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import sharp from "sharp";
import * as z from "zod";
import { createConfigFeature } from "../../config/index.js";
import { derivativesSharpFeature } from "../../derivatives-sharp/index.js";
import { fileFoundationFeature } from "../../file-foundation/index.js";
import { createFileDerivativesFeature } from "../feature.js";

const tenantId = testTenantId(1);
const user = createTestUser({ id: 1, tenantId, roles: ["Admin"] });

const generatorFeature = defineFeature("server-created-file-ref-fixture", (r) => {
  r.requires({ features: ["file-derivatives"] });
  r.writeHandler({
    name: "generate-and-thumb",
    schema: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    handler: async (event, ctx) => {
      if (!ctx.derivatives) {
        return writeFailure(new InternalError({ message: "ctx.derivatives missing" }));
      }
      const png = await sharp({
        create: {
          width: event.payload.width,
          height: event.payload.height,
          channels: 3,
          background: { r: 200, g: 60, b: 60 },
        },
      })
        .png()
        .toBuffer();
      const created = await createFileRefFromBytes(ctx, {
        fileName: "generated.png",
        mimeType: "image/png",
        data: new Uint8Array(png),
      });
      if (!created.isSuccess) return created;
      const variant = await ctx.derivatives.variant(
        created.data.id,
        { maxEdge: 100, fit: "inside", format: "webp" },
        "thumb",
      );
      return {
        isSuccess: true as const,
        data: { fileRefId: created.data.id, variantKey: variant.storageKey },
      };
    },
    access: { openToAll: { reason: "test fixture: any signed-in user may generate" } },
  });
});

let stack: TestStack;
let provider: InMemoryFileProvider;

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      fileFoundationFeature,
      createFilesFeature(),
      createFileDerivativesFeature(),
      derivativesSharpFeature,
      generatorFeature,
    ],
    files: { storageProvider: provider },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("server-created FileRef + ctx.derivatives", () => {
  test("a generated image gets a real resized variant stored next to the original", async () => {
    const result = await stack.http.writeOk<{ fileRefId: string; variantKey: string }>(
      "server-created-file-ref-fixture:write:generate-and-thumb",
      { width: 400, height: 300 },
      user,
    );

    expect(result.variantKey.startsWith(`${tenantId}/`)).toBe(true);
    const meta = await sharp(Buffer.from(await provider.read(result.variantKey))).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(100);
  });
});
