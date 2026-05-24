import { describe, expect, test } from "bun:test";
import type { S3ProviderConfig } from "../s3-provider";
import { resolveForcePathStyle } from "../s3-provider";

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
