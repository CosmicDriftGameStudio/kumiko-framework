// An app without any anonymousUpload field: an anonymous caller gets the 401 even with a large
// body, not the 413 of the opted-in cap. Real HTTP via setupTestStack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createFileField, defineFeature } from "../../engine/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const LARGER_THAN_ANONYMOUS_MARGIN_BYTES = 512 * 1024;

const closedFeature = defineFeature("closedupload", (r) => {
  r.entity({
    name: "photo",
    table: "closedupload_photos",
    fields: { closed: createFileField({ accept: ["pdf"], maxSize: "50mb" }) },
  });
});

let stack: TestStack;
beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), closedFeature],
    files: { storageProvider: createInMemoryFileProvider() },
    anonymousAccess: { defaultTenantId: testTenantId(1) },
    trustedProxyHops: 1,
  });
});
afterAll(async () => {
  await stack.cleanup();
});

describe("an anonymous upload in an app without anonymousUpload fields", () => {
  test("a large body gets 401, not 413", async () => {
    const fd = new FormData();
    fd.append("entityType", "photo");
    fd.append("fieldName", "closed");
    fd.append(
      "file",
      new File([new Uint8Array(LARGER_THAN_ANONYMOUS_MARGIN_BYTES)], "doc.pdf", {
        type: "application/pdf",
      }),
    );
    const { body, contentType } = await buildMultipartBody(fd);
    const res = await stack.app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": contentType, "x-forwarded-for": "9.9.7.9" },
      body,
    });
    expect(res.status).toBe(401);
  });
});
