// feature.ts contract tests — pin the public surface that consumers
// (file-upload handlers, future tier-engine-gated storage) will rely on.
//
// **Pattern-Vorbild:** mirrors mail-foundation + ai-foundation feature
// shape tests.

import { describe, expect, test } from "vitest";
import { fileFoundationFeature, S3_SECRET_ACCESS_KEY } from "../feature";

// =============================================================================
// Feature shape
// =============================================================================

describe("fileFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(fileFoundationFeature.name).toBe("file-foundation");
  });

  test("declares config + secrets as hard requirements", () => {
    expect(fileFoundationFeature.requires).toContain("config");
    expect(fileFoundationFeature.requires).toContain("secrets");
  });
});

// =============================================================================
// Exports — typed handles surface
// =============================================================================

describe("fileFoundationFeature.exports — typed handles", () => {
  test("exports.configKeys covers the S3-config knobs", () => {
    const keys = fileFoundationFeature.exports.configKeys;
    expect(keys.provider).toBeDefined();
    expect(keys.bucket).toBeDefined();
    expect(keys.region).toBeDefined();
    expect(keys.endpoint).toBeDefined();
    expect(keys.forcePathStyle).toBeDefined();
    expect(keys.accessKeyId).toBeDefined();
  });

  test("exports.secretAccessKey is the S3_SECRET_ACCESS_KEY secret-handle (drift-pin)", () => {
    expect(fileFoundationFeature.exports.secretAccessKey).toBe(S3_SECRET_ACCESS_KEY);
    // Pin the EXACT qualified-name — framework builds as
    // `<feature-kebab>:secret:<short-name-kebab>` via toKebab, so
    // "s3.secretAccessKey" → "s3-secret-access-key". A rename of either
    // half breaks every tenant-stored secret.
    expect(S3_SECRET_ACCESS_KEY.name).toBe("file-foundation:secret:s3-secret-access-key");
  });
});

// =============================================================================
// Secret redaction
// =============================================================================

describe("S3_SECRET_ACCESS_KEY — generic redaction", () => {
  const secretDef = fileFoundationFeature.secretKeys["s3.secretAccessKey"];

  test("redact preserves first 4 + last 4 chars for verifiability on long keys", () => {
    expect(secretDef?.redact).toBeDefined();
    // Typical AWS secret-access-key: 40 chars, base64-ish.
    expect(secretDef?.redact?.("AKIA1234567890ABCDEFGHIJ7890klmn")).toMatch(/^AKIA\.\.\.klmn$/);
  });

  test("redact masks short keys completely (no leak on under-8-char input)", () => {
    expect(secretDef?.redact?.("short")).toBe("•".repeat(5));
  });
});
