// feature.ts contract tests for file-provider-s3.

import { describe, expect, test } from "bun:test";
import type { FileProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { fileProviderS3Feature, S3_SECRET_ACCESS_KEY } from "../feature";

describe("fileProviderS3Feature — shape", () => {
  test("has the expected name", () => {
    expect(fileProviderS3Feature.name).toBe("file-provider-s3");
  });

  test("requires config + secrets + file-foundation", () => {
    expect(fileProviderS3Feature.requires).toContain("config");
    expect(fileProviderS3Feature.requires).toContain("secrets");
    expect(fileProviderS3Feature.requires).toContain("file-foundation");
  });
});

describe("fileProviderS3Feature.exports — typed handles", () => {
  test("exports.configKeys covers the S3-config knobs", () => {
    const keys = fileProviderS3Feature.exports.configKeys;
    expect(keys.bucket).toBeDefined();
    expect(keys.region).toBeDefined();
    expect(keys.endpoint).toBeDefined();
    expect(keys.forcePathStyle).toBeDefined();
    expect(keys.accessKeyId).toBeDefined();
  });

  test("exports.secretAccessKey is the S3_SECRET_ACCESS_KEY secret-handle (drift-pin)", () => {
    expect(fileProviderS3Feature.exports.secretAccessKey).toBe(S3_SECRET_ACCESS_KEY);
    expect(S3_SECRET_ACCESS_KEY.name).toBe("file-provider-s3:secret:s3-secret-access-key");
  });
});

describe("S3_SECRET_ACCESS_KEY — generic redaction", () => {
  const secretDef = fileProviderS3Feature.secretKeys["s3.secretAccessKey"];

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
    const usages = fileProviderS3Feature.extensionUsages;
    expect(usages.some((u) => u.extensionName === "fileProvider" && u.entityName === "s3")).toBe(
      true,
    );
  });
});

// extension-usage `options` is engine-payload (unknown) — structurally validate.
function isFileProviderPlugin(o: unknown): o is FileProviderPlugin {
  return typeof o === "object" && o !== null && "build" in o && typeof o.build === "function";
}

function s3Plugin(): FileProviderPlugin {
  const options = fileProviderS3Feature.extensionUsages.find(
    (u) => u.extensionName === "fileProvider" && u.entityName === "s3",
  )?.options;
  if (!isFileProviderPlugin(options)) {
    throw new Error("file-provider-s3: s3 plugin not registered with a build()");
  }
  return options;
}

describe("fileProviderS3Feature — build() guard", () => {
  test("build ohne ctx.config wirft (config-feature nicht gemountet)", async () => {
    // Die tieferen Value-/Secret-Pfade (bucket/region/accessKeyId leer,
    // secret fehlt, Happy-Path) hängen an der echten Config-/Secrets-
    // Pipeline → S3-Integration-Test (setupTestStack + MinIO), nicht hier.
    // Die requireNonEmpty-Werteprüfung selbst ist über
    // foundation-shared/config-helpers abgedeckt.
    await expect(s3Plugin().build({}, "tenant-x")).rejects.toThrow("ctx.config is missing");
  });
});
