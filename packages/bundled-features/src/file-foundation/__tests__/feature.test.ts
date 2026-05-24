// feature.ts contract tests — pin the public surface of the
// Plugin-API-shaped file-foundation. Provider-specific configs/secrets
// are tested in their own provider-feature (file-provider-s3/__tests__).

import { describe, expect, test } from "bun:test";
import { fileFoundationFeature } from "../feature";

describe("fileFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(fileFoundationFeature.name).toBe("file-foundation");
  });

  test("declares config as a hard requirement (provider-selector lives there)", () => {
    expect(fileFoundationFeature.requires).toContain("config");
  });

  test("does NOT require secrets — provider-plugins own their own secrets", () => {
    expect(fileFoundationFeature.requires).not.toContain("secrets");
  });
});

describe("fileFoundationFeature.exports — typed handles", () => {
  test("exposes only the provider-selector config-key", () => {
    const keys = fileFoundationFeature.exports.configKeys;
    expect(keys.provider).toBeDefined();
    expect((keys as Record<string, unknown>)["bucket"]).toBeUndefined();
    expect((keys as Record<string, unknown>)["region"]).toBeUndefined();
  });
});

describe("fileFoundationFeature — registers extension-point", () => {
  test("declares the 'fileProvider' extension-point", () => {
    expect(fileFoundationFeature.registrarExtensions["fileProvider"]).toBeDefined();
  });
});
