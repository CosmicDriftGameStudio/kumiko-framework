// feature.ts contract tests — pin the public surface of the
// Plugin-API-shaped file-foundation. Provider-specific configs/secrets
// are tested in their own provider-feature (file-provider-s3/__tests__).

import { describe, expect, test } from "bun:test";
import { createFileFoundationFeature } from "../feature.js";

describe("fileFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(createFileFoundationFeature().name).toBe("file-foundation");
  });

  test("declares config as a hard requirement (provider-selector lives there)", () => {
    expect(createFileFoundationFeature().requires).toContain("config");
  });

  test("does NOT require secrets — provider-plugins own their own secrets", () => {
    expect(createFileFoundationFeature().requires).not.toContain("secrets");
  });
});

describe("fileFoundationFeature.exports — typed handles", () => {
  test("exposes the provider-selector handle", () => {
    expect(createFileFoundationFeature().exports.providerConfigKey).toBeDefined();
    expect(createFileFoundationFeature().exports.providerConfigKey.name).toBe(
      "file-foundation:config:provider",
    );
  });
});

describe("fileFoundationFeature — registers extension-point", () => {
  test("declares the 'fileProvider' extension-point", () => {
    expect(createFileFoundationFeature().registrarExtensions["fileProvider"]).toBeDefined();
  });
});
