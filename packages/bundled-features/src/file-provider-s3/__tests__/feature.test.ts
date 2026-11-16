// feature.ts contract tests for file-provider-s3.

import { describe, expect, test } from "bun:test";
import {
  type FileProviderPlugin,
  isFileProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { createFileProviderS3NamedEnvFeature } from "../env-named-feature.ts";
import { createFileProviderS3Feature, S3_SECRET_ACCESS_KEY } from "../feature.ts";

describe("S3 env providers — names and provider keys", () => {
  test("createFileProviderS3Feature({ fromEnv: true }) keeps the feature name and the s3-env key", () => {
    const feature = createFileProviderS3Feature({ fromEnv: true });
    expect(feature.name).toBe("file-provider-s3-env");
    expect(feature.requires).toContain("file-foundation");
    expect(feature.requires).not.toContain("secrets");
    const usage = feature.extensionUsages.find(
      (u) => u.extensionName === "fileProvider" && u.entityName === "s3-env",
    );
    expect(isFileProviderPlugin(usage?.options)).toBe(true);
  });

  test("a named provider is mounted as file-provider-s3-env-<name> under the <name> key", () => {
    const feature = createFileProviderS3NamedEnvFeature({
      name: "releases",
      envPrefix: "RELEASES_S3_",
    });
    expect(feature.name).toBe("file-provider-s3-env-releases");
    const usage = feature.extensionUsages.find(
      (u) => u.extensionName === "fileProvider" && u.entityName === "releases",
    );
    expect(isFileProviderPlugin(usage?.options)).toBe(true);
  });
});

describe("fileProviderS3Feature — shape", () => {
  test("has the expected name", () => {
    expect(createFileProviderS3Feature().name).toBe("file-provider-s3");
  });

  test("requires config + secrets + file-foundation", () => {
    expect(createFileProviderS3Feature().requires).toContain("config");
    expect(createFileProviderS3Feature().requires).toContain("secrets");
    expect(createFileProviderS3Feature().requires).toContain("file-foundation");
  });
});

describe("fileProviderS3Feature.exports — typed handles", () => {
  test("exports.configKeys covers the S3-config knobs", () => {
    const keys = createFileProviderS3Feature().exports.configKeys;
    expect(keys.bucket).toBeDefined();
    expect(keys.region).toBeDefined();
    expect(keys.endpoint).toBeDefined();
    expect(keys.forcePathStyle).toBeDefined();
    expect(keys.accessKeyId).toBeDefined();
  });

  test("exports.secretAccessKey is the S3_SECRET_ACCESS_KEY secret-handle (drift-pin)", () => {
    expect(createFileProviderS3Feature().exports.secretAccessKey).toEqual(S3_SECRET_ACCESS_KEY);
    expect(S3_SECRET_ACCESS_KEY.name).toBe("file-provider-s3:secret:s3-secret-access-key");
  });
});

describe("S3_SECRET_ACCESS_KEY — generic redaction", () => {
  const secretDef = createFileProviderS3Feature().secretKeys["s3.secretAccessKey"];

  test("redact preserves first 4 + last 4 chars on long keys", () => {
    expect(secretDef?.redact).toBeDefined();
    expect(secretDef?.redact?.("AKIA1234567890ABCDEFGHIJ7890klmn")).toMatch(/^AKIA\.\.\.klmn$/);
  });

  test("redact masks short keys completely", () => {
    expect(secretDef?.redact?.("short")).toBe("•".repeat(5));
  });
});

describe("fileProviderS3Feature — plugin-registration", () => {
  test("registers itself under entityName 's3' for file-foundation's extension", () => {
    const usages = createFileProviderS3Feature().extensionUsages;
    expect(usages.some((u) => u.extensionName === "fileProvider" && u.entityName === "s3")).toBe(
      true,
    );
  });
});

function s3Plugin(): FileProviderPlugin {
  const options = createFileProviderS3Feature().extensionUsages.find(
    (u) => u.extensionName === "fileProvider" && u.entityName === "s3",
  )?.options;
  if (!isFileProviderPlugin(options)) {
    throw new Error("file-provider-s3: s3 plugin not registered with a build()");
  }
  return options;
}

describe("fileProviderS3Feature — build() guard", () => {
  test("build without ctx.config throws (config feature is not mounted)", async () => {
    // The deeper value/secret paths (empty bucket/region/accessKeyId,
    // missing secret, happy path) depend on the real Config/Secrets pipeline
    // and belong in an S3 integration test (setupTestStack + MinIO), not here.
    // requireNonEmpty validation is covered by foundation-shared/config-helpers.
    await expect(s3Plugin().build({ secrets: undefined }, "tenant-x")).rejects.toThrow(
      "ctx.config is missing",
    );
  });
});
