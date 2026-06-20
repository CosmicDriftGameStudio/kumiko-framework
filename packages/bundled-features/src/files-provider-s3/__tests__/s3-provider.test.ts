import { describe, expect, test } from "bun:test";
import type { S3ProviderConfig } from "../s3-provider";
import { createS3Provider, resolveForcePathStyle, resolveVirtualHostedStyle } from "../s3-provider";

const baseConfig: S3ProviderConfig = {
  bucket: "b",
  region: "us-east-1",
  accessKeyId: "a",
  secretAccessKey: "s",
};

describe("resolveForcePathStyle", () => {
  test("no endpoint + no override → false (AWS virtual-host default)", () => {
    expect(resolveForcePathStyle(baseConfig)).toBe(false);
  });

  test("custom endpoint + no override → true (auto-detect for Minio/R2/etc.)", () => {
    expect(resolveForcePathStyle({ ...baseConfig, endpoint: "http://localhost:9000" })).toBe(true);
  });

  test("explicit true override always wins, even without endpoint", () => {
    expect(resolveForcePathStyle({ ...baseConfig, forcePathStyle: true })).toBe(true);
  });

  test("explicit false override always wins, even with custom endpoint", () => {
    // Edge case: someone running a custom endpoint that does support
    // virtual-host-style (rare, but legal) can opt out.
    expect(
      resolveForcePathStyle({
        ...baseConfig,
        endpoint: "http://localhost:9000",
        forcePathStyle: false,
      }),
    ).toBe(false);
  });
});

// virtualHostedStyle is the inversion createS3Provider hands to Bun.S3Client.
// The `!` is the silent drift point: flip it and Minio/R2 pick the wrong URL
// form with no compile or runtime error.
describe("resolveVirtualHostedStyle (inverse of forcePathStyle)", () => {
  const cases: ReadonlyArray<{ name: string; config: S3ProviderConfig }> = [
    { name: "no endpoint + no override", config: baseConfig },
    { name: "custom endpoint", config: { ...baseConfig, endpoint: "http://localhost:9000" } },
    { name: "explicit forcePathStyle true", config: { ...baseConfig, forcePathStyle: true } },
    {
      name: "custom endpoint + explicit false",
      config: { ...baseConfig, endpoint: "http://localhost:9000", forcePathStyle: false },
    },
  ];

  for (const { name, config } of cases) {
    test(`${name} → strict inverse of resolveForcePathStyle`, () => {
      expect(resolveVirtualHostedStyle(config)).toBe(!resolveForcePathStyle(config));
    });
  }

  test("AWS default (no endpoint) → virtual-host-style true", () => {
    expect(resolveVirtualHostedStyle(baseConfig)).toBe(true);
  });

  test("Minio/R2 (custom endpoint) → virtual-host-style false (= path-style)", () => {
    expect(resolveVirtualHostedStyle({ ...baseConfig, endpoint: "http://localhost:9000" })).toBe(
      false,
    );
  });
});

// presign is a pure local signing operation (HMAC, no network), so it tests
// hermetically with dummy credentials. Proves Bun actually signs contentDisposition
// as the response-content-disposition query param — otherwise a download would
// silently return the UUID key instead of the filename.
describe("getSignedUrl contentDisposition", () => {
  const provider = createS3Provider({
    bucket: "b",
    region: "us-east-1",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
  });

  test("signs response-content-disposition into the presigned URL", async () => {
    const url = await provider.getSignedUrl?.("uuid-key.bin", 60, {
      contentDisposition: 'attachment; filename="report.pdf"',
    });
    expect(url).toBeDefined();
    const params = new URL(url ?? "").searchParams;
    expect(params.get("response-content-disposition")).toBe('attachment; filename="report.pdf"');
  });

  test("omits the param when no contentDisposition is passed", async () => {
    const url = await provider.getSignedUrl?.("uuid-key.bin", 60);
    expect(url).toBeDefined();
    expect(new URL(url ?? "").searchParams.has("response-content-disposition")).toBe(false);
  });
});
