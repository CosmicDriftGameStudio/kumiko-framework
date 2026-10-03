import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { createS3ProviderFromEnv } from "../env-helper.js";

// Runs against the S3-compatible container from docker-compose (MINIO_* env),
// the same one s3-provider.integration.test.ts needs.
const S3_ENV_PREFIX = "MINIO_";

let stack: TestStack;
let provider: FileStorageProvider;
const uploadedKeys: string[] = [];

beforeAll(async () => {
  provider = createS3ProviderFromEnv(S3_ENV_PREFIX);
  stack = await setupTestStack({ features: [], files: { storageProvider: provider } });
});

afterAll(async () => {
  for (const key of uploadedKeys) await provider.delete(key);
  await stack.cleanup();
});

describe("upload without entityId against an S3-compatible store", () => {
  test("is accepted with 201 and the stored bytes are readable", async () => {
    const token = await stack.jwt.sign(TestUsers.admin);
    const bytes = new TextEncoder().encode("<?xml version='1.0'?><Invoice/>");
    const formData = new FormData();
    formData.append(
      "file",
      new File([Buffer.from(bytes)], "invoice.xml", { type: "application/xml" }),
    );

    const res = await stack.app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; storageKey: string };
    uploadedKeys.push(body.storageKey);
    expect(body.storageKey).not.toContain("//");

    const download = await stack.app.request(`/api/files/${body.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
    expect(await provider.read(body.storageKey)).toEqual(bytes);
  });
});
