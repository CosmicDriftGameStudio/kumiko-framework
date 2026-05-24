// feature.ts contract tests for mail-transport-smtp — pins the
// SMTP-specific config-keys + secret-handle that the plugin owns.
// Plugin-registration shape is also pinned (drift-pin: name "smtp",
// build-fn presence).

import { describe, expect, test } from "bun:test";
import { mailTransportSmtpFeature, SMTP_PASSWORD } from "../feature";

describe("mailTransportSmtpFeature — shape", () => {
  test("has the expected name", () => {
    expect(mailTransportSmtpFeature.name).toBe("mail-transport-smtp");
  });

  test("requires config + secrets + mail-foundation as hard dependencies", () => {
    expect(mailTransportSmtpFeature.requires).toContain("config");
    expect(mailTransportSmtpFeature.requires).toContain("secrets");
    expect(mailTransportSmtpFeature.requires).toContain("mail-foundation");
  });
});

describe("mailTransportSmtpFeature.exports — typed handles", () => {
  test("exports.configKeys covers the SMTP-config knobs", () => {
    const keys = mailTransportSmtpFeature.exports.configKeys;
    expect(keys.host).toBeDefined();
    expect(keys.port).toBeDefined();
    expect(keys.secure).toBeDefined();
    expect(keys.from).toBeDefined();
    expect(keys.authUser).toBeDefined();
  });

  test("exports.password is the SMTP_PASSWORD secret-handle (drift-pin)", () => {
    expect(mailTransportSmtpFeature.exports.password).toBe(SMTP_PASSWORD);
    expect(SMTP_PASSWORD.name).toBe("mail-transport-smtp:secret:smtp-password");
  });
});

describe("SMTP_PASSWORD — generic redaction", () => {
  const secretDef = mailTransportSmtpFeature.secretKeys["smtp.password"];

  test("redact preserves first 3 + last 2 chars for verifiability on long keys", () => {
    expect(secretDef?.redact).toBeDefined();
    expect(secretDef?.redact?.("brevoXKEY01abc")).toMatch(/^bre\.\.\.bc$/);
  });

  test("redact masks short keys completely (no leak on under-8-char input)", () => {
    expect(secretDef?.redact?.("shortpw")).toBe("•".repeat(7));
  });
});

describe("mailTransportSmtpFeature — plugin-registration", () => {
  test("registers itself under entityName 'smtp' for mail-foundation's extension", () => {
    // r.useExtension("mailTransport", "smtp", ...) lands in the feature's
    // feature.extensionUsages. Drift-pin: tenant sets `mail-foundation:
    // config:provider = "smtp"` and the foundation-factory looks up by
    // exactly this name.
    const usages = mailTransportSmtpFeature.extensionUsages;
    expect(usages.some((u) => u.extensionName === "mailTransport" && u.entityName === "smtp")).toBe(
      true,
    );
  });
});
