// feature.ts contract tests — pin the public surface that consumers
// (auth-email-password reset flows, custom notification-handlers, future
// delivery-channel-switch via tier-engine) will rely on:
//   - mailFoundationFeature is a valid FeatureDefinition with the
//     expected name, requires, config-keys, secret declaration.
//   - exports.configKeys carries typed handles (provider, host, port,
//     secure, from, authUser).
//   - exports.password is the SMTP_PASSWORD secret-handle.
//
// **Pattern-Vorbild:** mirrors ai-foundation/__tests__/feature.test.ts.

import { describe, expect, test } from "vitest";
import { mailFoundationFeature, SMTP_PASSWORD } from "../feature";

// =============================================================================
// Feature shape
// =============================================================================

describe("mailFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(mailFoundationFeature.name).toBe("mail-foundation");
  });

  test("declares config + secrets as hard requirements", () => {
    expect(mailFoundationFeature.requires).toContain("config");
    expect(mailFoundationFeature.requires).toContain("secrets");
  });
});

// =============================================================================
// Exports — typed handles surface
// =============================================================================

describe("mailFoundationFeature.exports — typed handles", () => {
  test("exports.configKeys covers the SMTP-config knobs", () => {
    const keys = mailFoundationFeature.exports.configKeys;
    // Spell each one out — if a future refactor accidentally drops a key,
    // the test fails by name not by count.
    expect(keys.provider).toBeDefined();
    expect(keys.host).toBeDefined();
    expect(keys.port).toBeDefined();
    expect(keys.secure).toBeDefined();
    expect(keys.from).toBeDefined();
    expect(keys.authUser).toBeDefined();
  });

  test("exports.password is the SMTP_PASSWORD secret-handle (drift-pin)", () => {
    expect(mailFoundationFeature.exports.password).toBe(SMTP_PASSWORD);
    // Pin the EXACT qualified-name — framework builds as
    // `<feature-kebab>:secret:<short-name-kebab>` via toKebab, so
    // "smtp.password" → "smtp-password". A rename of either half breaks
    // every tenant-stored secret.
    expect(SMTP_PASSWORD.name).toBe("mail-foundation:secret:smtp-password");
  });
});

// =============================================================================
// Secret redaction
// =============================================================================

describe("SMTP_PASSWORD — generic redaction", () => {
  const secretDef = mailFoundationFeature.secretKeys["smtp.password"];

  test("redact preserves first 3 + last 2 chars for verifiability on long keys", () => {
    expect(secretDef?.redact).toBeDefined();
    expect(secretDef?.redact?.("brevoXKEY01abc")).toMatch(/^bre\.\.\.bc$/);
  });

  test("redact masks short keys completely (no leak on under-8-char input)", () => {
    expect(secretDef?.redact?.("shortpw")).toBe("•".repeat(7));
  });
});
